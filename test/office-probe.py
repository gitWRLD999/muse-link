"""Disposable independent Office instance for opt-in live COM verification."""
import json
import ctypes
import sys
import time
import win32com.client
import win32gui

kind, x, y, output = sys.argv[1:]
ctypes.windll.user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
app = document = None
previous_alerts = None
try:
    app = win32com.client.DispatchEx("Word.Application" if kind == "word" else "Excel.Application")
    previous_alerts = app.DisplayAlerts
    collection = "Documents" if kind == "word" else "Workbooks"
    if getattr(app, collection).Count:
        raise RuntimeError("Office provider reused an instance with existing documents; disposable fixture refused")
    app.DisplayAlerts = 0
    if kind == "word":
        document = app.Documents.Add()
        document.Content.Text = "Muse Link disposable Word API test\r"
    else:
        document = app.Workbooks.Add()
        document.Worksheets(1).Name = "AgentTest"
        document.Worksheets("AgentTest").Range("A1").Value = "Muse Link disposable Excel API test"
    hwnd = int(document.Windows(1).Hwnd) & 0xffffffff
    hwnd = win32gui.GetAncestor(hwnd, 2)
    document.Windows(1).WindowState = 0 if kind == "word" else -4143
    # Place the private hidden instance before showing without activation.
    win32gui.SetWindowPos(hwnd, 0, int(x) + 60, int(y) + 60, 900, 800, 0x214)
    win32gui.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
    time.sleep(1)
    with open(output, "w", encoding="utf-8") as file:
        json.dump({"hwnd": hwnd, "app": kind, "class":win32gui.GetClassName(hwnd),"visible":win32gui.IsWindowVisible(hwnd),"enabled":win32gui.IsWindowEnabled(hwnd),"bounds":win32gui.GetWindowRect(hwnd),"title":win32gui.GetWindowText(hwnd)}, file)
    sys.stdin.readline()
finally:
    if document is not None:
        try:
            document.Close(0)
        except Exception:
            pass
    if app is not None:
        try:
            if previous_alerts is not None:
                app.DisplayAlerts = previous_alerts
            if not getattr(app, "Documents" if kind == "word" else "Workbooks").Count:
                app.Quit()
        except Exception:
            pass
