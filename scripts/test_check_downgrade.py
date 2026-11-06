import importlib.util
import pathlib
import time
import unittest

spec = importlib.util.spec_from_file_location('check_downgrade', pathlib.Path(__file__).with_name('check-downgrade.py'))
check_downgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_downgrade)


class WaitHealthyTest(unittest.TestCase):
    def test_wait_healthy_fails_fast_when_container_exits(self):
        calls = []

        def running():
            calls.append(1)
            return len(calls) <= 2

        start = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, 'container exited'):
            check_downgrade.wait_healthy(lambda: False, running, timeout=30)
        self.assertLess(time.monotonic() - start, 1)

    def test_wait_healthy_times_out(self):
        with self.assertRaises(TimeoutError):
            check_downgrade.wait_healthy(lambda: False, lambda: True, timeout=0.3)

    def test_wait_healthy_returns_when_probe_succeeds(self):
        answers = iter([False, False, True])
        self.assertIsNone(check_downgrade.wait_healthy(lambda: next(answers), lambda: True, timeout=5, interval=0.01))


class SettingsProblemsTest(unittest.TestCase):
    def test_settings_problems_reports_changed_theme(self):
        self.assertEqual(check_downgrade.settings_problems({'interfaceTheme': 'nord'}, {'interfaceTheme': 'default'}), ['interfaceTheme changed after downgrade'])

    def test_settings_problems_reports_missing_key(self):
        saved = {'interfaceTheme': 'nord', 'widgets': {'dashboard': True}}
        self.assertEqual(check_downgrade.settings_problems(saved, {'interfaceTheme': 'nord'}), ['widgets changed after downgrade'])

    def test_settings_problems_ignores_unknown_keys(self):
        reread = {key: [key] for key in check_downgrade.COMPARED_KEYS}
        saved = dict(reread, futureLayout={'density': 'compact'}, schemaHint=19)
        self.assertEqual(check_downgrade.settings_problems(saved, reread), [])


class ContainerNameTest(unittest.TestCase):
    def test_container_names_are_unique(self):
        names = {check_downgrade.container_name('scopearr-downgrade') for _ in range(100)}
        self.assertEqual(len(names), 100)
        for name in names:
            self.assertRegex(name, r'^scopearr-downgrade-[0-9a-f]{8}$')


if __name__ == '__main__':
    unittest.main()
