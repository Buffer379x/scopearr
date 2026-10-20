"""Require successful push CI for the exact commit before publishing a release."""
import json
import os
import sys
import time
import urllib.parse
import urllib.request


def ci_state(runs, sha):
    matching = [run for run in runs if run.get('head_sha') == sha and run.get('event') == 'push']
    if not matching:
        return 'waiting'
    latest = max(matching, key=lambda run: run['id'])
    if latest['status'] != 'completed':
        return 'waiting'
    return 'success' if latest['conclusion'] == 'success' else 'failure'


def main():
    repository = os.environ['GITHUB_REPOSITORY']
    sha = os.environ['GITHUB_SHA']
    query = urllib.parse.urlencode({'head_sha': sha, 'event': 'push', 'per_page': 100})
    url = f'https://api.github.com/repos/{repository}/actions/workflows/ci.yml/runs?{query}'
    deadline = time.monotonic() + 900
    while True:
        request = urllib.request.Request(url, headers={
            'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        })
        with urllib.request.urlopen(request, timeout=30) as response:
            state = ci_state(json.load(response)['workflow_runs'], sha)
        if state == 'success':
            print(f'Main CI passed for {sha}. Release publication is allowed.')
            return 0
        if state == 'failure':
            print(f'Main CI failed for {sha}. Release publication is blocked.', file=sys.stderr)
            return 1
        if time.monotonic() >= deadline:
            print(f'Main CI did not complete for {sha}. Release publication is blocked.', file=sys.stderr)
            return 1
        print(f'Waiting for Main CI at {sha}...', flush=True)
        time.sleep(15)


if __name__ == '__main__':
    sys.exit(main())
