"""Private persistent app/vision worker. No foreground input or arbitrary code tools."""
import contextlib
import importlib.util
import json
import os
import sys
import time
import types
from pathlib import Path

UFO = Path(os.environ.get("MUSE_UFO_ROOT", ""))
OMNI = Path(os.environ.get("MUSE_OMNI_ROOT", ""))
MODEL = Path(os.environ.get("MUSE_OMNI_MODEL", ""))
OCR = Path(os.environ.get("MUSE_EASYOCR_MODELS", ""))
sys.path.insert(0, str(UFO))
detector = reader = None


def office_classes():
    # Load the app API packages without UFO's unrelated host UI/controller imports.
    for name, folder in [("ufo", "ufo"), ("ufo.automator", "ufo/automator"),
                         ("ufo.automator.app_apis", "ufo/automator/app_apis")]:
        if name not in sys.modules:
            package = types.ModuleType(name)
            package.__path__ = [str(UFO / folder)]
            sys.modules[name] = package
    from ufo.automator.app_apis.word.wordclient import WordWinCOMReceiver
    from ufo.automator.app_apis.excel.excelclient import ExcelWinCOMReceiver
    return WordWinCOMReceiver, ExcelWinCOMReceiver


def exact_document(hwnd):
    """Attach only to running Office; never Dispatch/launch or choose fuzzy titles."""
    import pythoncom
    import win32gui
    import win32com.client
    matches = []
    def top_handle(window):
        return win32gui.GetAncestor(int(window.Hwnd) & 0xffffffff, 2)
    # Office exposes an exact document Window via OBJID_NATIVEOM. This also
    # handles multiple Office instances which GetActiveObject may not return.
    native_windows = []
    win32gui.EnumChildWindows(int(hwnd), lambda h, _: native_windows.append(h), None)
    for child in native_windows:
        cls = win32gui.GetClassName(child)
        if cls not in {"_WwG", "EXCEL7"}:
            continue
        try:
            lresult = win32gui.SendMessage(child, 0x3D, 0, -16)  # WM_GETOBJECT, OBJID_NATIVEOM
            native = win32com.client.Dispatch(pythoncom.ObjectFromLresult(lresult, pythoncom.IID_IDispatch, 0))
            app = native.Application
            kind, collection = ("word", "Documents") if cls == "_WwG" else ("excel", "Workbooks")
            exact = [d for d in getattr(app, collection)
                     if any(top_handle(w) == int(hwnd) for w in d.Windows)]
            if len(exact) == 1:
                return kind, app, exact[0]
            if len(exact) > 1:
                raise ValueError("Several documents share this top-level HWND. Use a separate document window.")
        except ValueError:
            raise
        except Exception:
            continue
    for kind, progid, collection in [("word", "Word.Application", "Documents"),
                                     ("excel", "Excel.Application", "Workbooks")]:
        try:
            app = win32com.client.GetActiveObject(progid)
            for document in getattr(app, collection):
                for window in document.Windows:
                    if top_handle(window) == int(hwnd):
                        matches.append((kind, app, document))
        except Exception:
            continue
    if len(matches) != 1:
        raise ValueError("Exact HWND must match one running Word document or Excel workbook; no Office launch/fuzzy fallback.")
    return matches[0]


def document_id(kind, document):
    return kind + ":" + str(document.FullName)


def inspect_office(kind, document, sheet_name=None):
    if kind == "word":
        return {"text": str(document.Content.Text)[:4000], "tableCount": int(document.Tables.Count)}
    sheets = [str(s.Name) for s in document.Worksheets]
    chosen = sheet_name or sheets[0]
    if chosen not in sheets:
        raise ValueError("Exact worksheet not found")
    data = document.Worksheets(chosen).Range("A1:T20").Value
    return {"sheets": sheets, "sheet": chosen, "range": "A1:T20", "values": data}


def office(request):
    kind, app, document = exact_document(request["hwnd"])
    identity = document_id(kind, document)
    action = request["action"]
    if action != "office_inspect" and identity != request["document_id"]:
        raise ValueError("Document identity changed; inspect again")
    if action != "office_inspect":
        word, excel = office_classes()
        cls = word if kind == "word" else excel
        # Bypass the upstream constructor's Dispatch and fuzzy document matching.
        receiver = cls.__new__(cls)
        receiver.client, receiver.com_object = app, document
        receiver.app_root_name = "WINWORD.EXE" if kind == "word" else "EXCEL.EXE"
        receiver.process_name = str(document.Name)
        if action == "ufo_word_insert_table" and kind == "word":
            outcome = receiver.insert_table(request["rows"], request["columns"])
        elif action == "ufo_excel_write_cells" and kind == "excel":
            sheets = [str(s.Name) for s in document.Worksheets]
            if request["sheet_name"] not in sheets:
                raise ValueError("Exact worksheet not found; no first-sheet fallback")
            outcome = receiver.insert_excel_table(request["sheet_name"], request["values"],
                                                   request["start_row"], request["start_column"])
        else:
            raise ValueError("Action does not match the exact observed Office app")
    else:
        outcome = None
    return {"ok": True, "backend": "microsoft-ufo-exact-window-com", "app": kind,
            "applicationName": str(getattr(app, "Name", kind)),
            "documentId": identity, "effect": outcome,
            "state": inspect_office(kind, document, request.get("sheet_name"))}


def parse(request):
    global detector, reader
    import numpy as np
    import torch
    from PIL import Image
    import easyocr
    torch.set_num_threads(2)
    started = time.monotonic()
    if detector is None:
        spec = importlib.util.spec_from_file_location("muse_omni_yolov9", OMNI / "util/yolov9.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        detector = module.YOLOv9Detector(model_path=MODEL, device="cpu")
    if reader is None:
        reader = easyocr.Reader(["en"], gpu=False, model_storage_directory=str(OCR),
                                download_enabled=False, verbose=False)
    with Image.open(request["screenshot"]) as original:
        image = original.convert("RGB")
    output = detector.predict(image, conf=0.25, imgsz=640, max_det=100)[0].boxes
    icons = [{"kind": "icon", "label": None, "confidence": float(score),
              "bbox": [float(v) for v in box], "caption": "unavailable"}
             for box, score in zip(output.xyxy.tolist(), output.conf.tolist())]
    words = []
    for polygon, content, confidence in reader.readtext(np.array(image), batch_size=1):
        xs, ys = [float(p[0]) for p in polygon], [float(p[1]) for p in polygon]
        words.append({"kind": "text", "label": content, "confidence": float(confidence),
                      "bbox": [min(xs), min(ys), max(xs), max(ys)]})
    return {"ok": True, "backend": "microsoft-omniparser-yolov9+easyocr", "device": "cpu",
            "captionModel": False, "coordinates": "capture pixels, xyxy",
            "elements": words[:200] + icons, "width": image.width, "height": image.height,
            "timingMs": round((time.monotonic() - started) * 1000)}


def dispatch(request):
    if request["action"] == "status":
        try:
            word, excel = office_classes()
            ufo = {"ready": True, "installed": True, "mode": "exact-window app APIs",
                   "source": str(UFO), "supportedApps": ["word", "excel"]}
        except Exception as error:
            ufo = {"ready": False, "installed": UFO.is_dir(), "error": str(error)}
        ready = MODEL.is_file() and (OCR / "craft_mlt_25k.pth").is_file() and (OCR / "english_g2.pth").is_file()
        return {"ok": True, "ufo": ufo,
                "omniparser": {"ready": ready, "loaded": detector is not None,
                               "device": "cpu", "captionModel": False, "model": str(MODEL)}}
    if request["action"] == "parse":
        return parse(request)
    if request["action"] in {"office_inspect", "ufo_word_insert_table", "ufo_excel_write_cells"}:
        return office(request)
    raise ValueError("Unknown private app operation")


if __name__ == "__main__":
    for line in sys.stdin:
        try:
            # Keep upstream library prints/logs out of the JSON protocol.
            with contextlib.redirect_stdout(sys.stderr):
                response = dispatch(json.loads(line))
        except Exception as error:
            response = {"ok": False, "stop": True, "error": str(error)}
        print(json.dumps(response, ensure_ascii=False, default=str), flush=True)
