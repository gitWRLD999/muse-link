import argparse
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('muse_ssh', Path(__file__).resolve().parents[1] / 'scripts' / 'muse-ssh.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SshTests(unittest.TestCase):
    def options(self, **kwargs):
        data = dict(host='agent-pc', port=22, identity=None, node='node',
                    remote_script='C:/Tools/Muse Link/bin/muse-link.mjs', mcp=None)
        data.update(kwargs)
        return argparse.Namespace(**data)

    def test_key_only_strict_host_checking_and_quoted_path(self):
        command = module.ssh_command(self.options(identity='/keys/local-key'))
        self.assertIn('StrictHostKeyChecking=yes', command)
        self.assertIn('BatchMode=yes', command)
        self.assertIn('PasswordAuthentication=no', command)
        self.assertIn('IdentitiesOnly=yes', command)
        self.assertEqual(command[-1], '"node" "C:/Tools/Muse Link/bin/muse-link.mjs" --stdin')

    def test_mcp_stream_command(self):
        self.assertTrue(module.ssh_command(self.options(mcp='sidescreen'))[-1].endswith(' mcp sidescreen'))

    def test_persistent_json_channel(self):
        self.assertTrue(module.ssh_command(self.options(channel=True))[-1].endswith(' channel'))

    def test_shell_expansions_and_host_options_are_refused(self):
        for field, value in [('remote_script', 'C:/%SECRET%/tool'), ('remote_script', 'x"&whoami'), ('node', 'node|cmd'), ('host', '-oProxyCommand=evil'), ('mcp', 'chrome&cmd')]:
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    module.ssh_command(self.options(**{field: value}))

    def test_port_validation(self):
        with self.assertRaises(ValueError):
            module.ssh_command(self.options(port=65536))


if __name__ == '__main__':
    unittest.main()
