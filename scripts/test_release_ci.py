import importlib.util
import io
import json
from unittest import mock
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('release_ci', pathlib.Path(__file__).with_name('check-release-ci.py'))
release_ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_ci)


def run(id=1, status='completed', conclusion='success', sha='release', event='push'):
    return dict(id=id, status=status, conclusion=conclusion, head_sha=sha, event=event)


class ReleaseCIGateTest(unittest.TestCase):
    def test_requires_exact_commit_and_push_event(self):
        self.assertEqual(release_ci.ci_state([], 'release'), 'waiting')
        self.assertEqual(release_ci.ci_state([run(sha='other'), run(event='pull_request')], 'release'), 'waiting')

    def test_waits_for_pending_ci(self):
        for status in ['queued', 'in_progress', 'waiting']:
            self.assertEqual(release_ci.ci_state([run(status=status, conclusion=None)], 'release'), 'waiting')

    def test_only_success_allows_publication(self):
        self.assertEqual(release_ci.ci_state([run()], 'release'), 'success')
        for conclusion in ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', None]:
            self.assertEqual(release_ci.ci_state([run(conclusion=conclusion)], 'release'), 'failure')

    def test_latest_run_controls_gate(self):
        self.assertEqual(release_ci.ci_state([run(), run(id=2, conclusion='failure')], 'release'), 'failure')
        self.assertEqual(release_ci.ci_state([run(conclusion='failure'), run(id=2)], 'release'), 'success')


class ReleaseCIPublicationTest(unittest.TestCase):
    def check(self, runs, expected):
        environment = {'GITHUB_REPOSITORY': 'Buffer379x/scopearr', 'GITHUB_SHA': 'release', 'GH_TOKEN': 'synthetic'}
        response = io.StringIO(json.dumps({'workflow_runs': runs}))
        with mock.patch.dict(release_ci.os.environ, environment), \
                mock.patch.object(release_ci.urllib.request, 'urlopen', return_value=response), \
                mock.patch.object(release_ci.time, 'monotonic', side_effect=[0, 901]), \
                mock.patch.object(release_ci.time, 'sleep') as sleep, \
                mock.patch('sys.stdout', new_callable=io.StringIO), \
                mock.patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(release_ci.main(), expected)
            sleep.assert_not_called()

    def test_failed_ci_blocks_publication_immediately(self):
        self.check([run(conclusion='failure')], 1)

    def test_successful_ci_allows_publication(self):
        self.check([run()], 0)

    def test_missing_ci_blocks_after_deadline(self):
        self.check([], 1)


if __name__ == '__main__':
    unittest.main()
