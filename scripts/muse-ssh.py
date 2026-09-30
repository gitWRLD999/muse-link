#!/usr/bin/env python3
"""Agent-side CLI or MCP transport over an existing, verified SSH connection."""
import argparse
import json
import re
import subprocess
import sys


def windows_argument(value):
    # Windows OpenSSH normally passes the command through cmd.exe. Refuse its
    # expansion/operators rather than accidentally executing an injected path.
    if not value or re.search(r'["\r\n&|<>^%!]', value):
        raise ValueError('Unsupported character in Windows remote executable/script path')
    return '"' + value + '"'


def ssh_command(args):
    if args.host.startswith('-') or re.search(r'\s', args.host):
        raise ValueError('Invalid SSH host; use user@host or an SSH config alias')
    if not 1 <= args.port <= 65535:
        raise ValueError('Invalid SSH port')
    command = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'PasswordAuthentication=no', '-o', 'ConnectTimeout=15', '-p', str(args.port)]
    if args.identity:
        command += ['-i', args.identity, '-o', 'IdentitiesOnly=yes']
    if args.mcp and not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', args.mcp):
        raise ValueError('Invalid MCP engine')
    remote = windows_argument(args.node) + ' ' + windows_argument(args.remote_script)
    remote += ' mcp ' + args.mcp if args.mcp else ' --stdin'
    return command + [args.host, remote]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True, help='user@host or SSH config alias')
    parser.add_argument('--port', type=int, default=22)
    parser.add_argument('--identity', help='Local private key path; never copied to the PC')
    parser.add_argument('--node', default='node', help='Windows Node executable')
    parser.add_argument('--remote-script', required=True, help='Absolute Windows bin/muse-link.mjs path')
    parser.add_argument('--mcp', metavar='ENGINE', help='Forward MCP stdio instead of a single CLI request')
    parser.add_argument('engine', nargs='?', default='status')
    parser.add_argument('action', nargs='?', default='list')
    parser.add_argument('arguments', nargs='?', default='{}', help="JSON, or '-' to read stdin")
    args = parser.parse_args()
    command = ssh_command(args)
    if args.mcp:
        return subprocess.run(command).returncode
    payload = {'method': 'status'} if args.engine == 'status' else {
        'engine': args.engine, 'method': 'list' if args.action == 'list' else 'call',
        'tool': args.action, 'arguments': json.loads(sys.stdin.read() if args.arguments == '-' else args.arguments)
    }
    return subprocess.run(command, input=json.dumps(payload), text=True, timeout=180).returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'ok': False, 'error': str(error)}), file=sys.stderr)
        sys.exit(1)
