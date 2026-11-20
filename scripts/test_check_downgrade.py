import importlib.util
import os
import pathlib
import shutil
import sqlite3
import tempfile
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


ARRIVAL = {'id': 1, 'audioTracks': [{'language': 'Deutsch', 'codec': 'DTS', 'channels': 6, 'channelLayout': '5.1'}, {'language': 'Englisch', 'codec': 'AC-3', 'channels': 6, 'channelLayout': '5.1'}]}


class RuleProblemsTest(unittest.TestCase):
    def rules(self, *ids):
        return [{'id': 'default-resolution-0'}] + [{'id': rule_id} for rule_id in ids]

    def test_all_rules_present(self):
        self.assertEqual(check_downgrade.rule_problems(self.rules(*check_downgrade.DEFAULT_RULE_IDS_200)), [])

    def test_missing_rule(self):
        self.assertEqual(check_downgrade.rule_problems(self.rules('default-hdr-sdr', 'default-channels-6-1')), ['default-channels-1-0 is missing'])

    def test_duplicate_rule(self):
        rules = self.rules(*check_downgrade.DEFAULT_RULE_IDS_200, 'default-hdr-sdr')
        self.assertEqual(check_downgrade.rule_problems(rules), ['default-hdr-sdr appears 2 times'])


class TrackValueTest(unittest.TestCase):
    def test_joins_parts(self):
        self.assertEqual(check_downgrade.track_value('Deutsch', 'DTS', ''), 'Deutsch|DTS|')

    def test_rejects_separator_in_part(self):
        for parts in (('De|utsch', 'DTS', ''), ('Deutsch', 'D|TS', ''), ('Deutsch', 'DTS', '5|1')):
            with self.assertRaises(ValueError):
                check_downgrade.track_value(*parts)


class CombinationProbeTest(unittest.TestCase):
    def test_picks_arrival_shape(self):
        items = [{'id': 14, 'audioTracks': []}, {'id': 3}, {'id': 7, 'audioTracks': [{'language': 'Englisch', 'codec': 'DTS'}]}, ARRIVAL]
        self.assertEqual(check_downgrade.combination_probe(items), (1, 'Deutsch|DTS|', 'Deutsch|AC-3|'))

    def test_skips_files_without_two_different_tracks(self):
        items = [
            {'id': 5, 'audioTracks': [{'language': 'Deutsch', 'codec': 'DTS'}, {'language': 'Deutsch', 'codec': 'AC-3'}]},
            {'id': 6, 'audioTracks': [{'language': 'Deutsch', 'codec': 'DTS'}, {'language': 'Englisch', 'codec': 'DTS'}]},
            {'id': 8, 'audioTracks': [{'language': '', 'codec': 'DTS'}, {'language': 'Englisch', 'codec': 'AC-3'}]},
        ]
        with self.assertRaises(RuntimeError):
            check_downgrade.combination_probe(items)

    def test_skips_files_whose_crossed_value_also_matches(self):
        crossed = {'id': 9, 'audioTracks': ARRIVAL['audioTracks'] + [{'language': 'Deutsch', 'codec': 'AC-3'}]}
        self.assertEqual(check_downgrade.combination_probe([crossed, ARRIVAL])[0], 1)

    def test_no_files(self):
        with self.assertRaises(RuntimeError):
            check_downgrade.combination_probe([])


class TrackMatchesTest(unittest.TestCase):
    def test_same_track_only(self):
        crossed = {'id': 2, 'audioTracks': [{'language': 'Deutsch', 'codec': 'AC-3'}, {'language': 'Englisch', 'codec': 'DTS'}]}
        self.assertEqual(check_downgrade.track_matches([ARRIVAL, crossed, {'id': 3}], 'Deutsch', 'DTS'), {1})


class SqliteLogProblemsTest(unittest.TestCase):
    def test_finds_sqlite_errors(self):
        text = '2026/11/07 INFO [system] Scopearr 1.7.0 started\n2026/11/07 ERROR [sync] SQL logic error: no such table: x (1)\n2026/11/07 constraint failed: FOREIGN KEY constraint failed (787)'
        self.assertEqual(check_downgrade.sqlite_log_problems(text), text.splitlines()[1:])

    def test_clean_log(self):
        self.assertEqual(check_downgrade.sqlite_log_problems('2026/11/07 INFO [auth] Signed in from 127.0.0.1 demo\n'), [])

    def test_mentioning_sqlite_is_not_an_error(self):
        self.assertEqual(check_downgrade.sqlite_log_problems('2026/11/07 INFO [system] Opened SQLite database /data/scopearr.db\n'), [])


class IndexTriggerTest(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp(prefix='scopearr-downgrade-test-')
        self.addCleanup(shutil.rmtree, self.data, True)
        connection = sqlite3.connect(os.path.join(self.data, 'scopearr.db'))
        connection.executescript(f'''
            CREATE TABLE files(data TEXT);
            CREATE TABLE file_audio_tracks(file_rowid INTEGER, position INTEGER, language TEXT, codec TEXT, channels TEXT);
            CREATE TRIGGER {check_downgrade.INDEX_TRIGGER} AFTER UPDATE OF data ON files BEGIN SELECT 1; END;
            INSERT INTO file_audio_tracks VALUES(1, 0, 'Deutsch', 'DTS', '5.1');
        ''')
        connection.commit()
        connection.close()

    def test_drop_also_empties_the_index(self):
        # The next start must refill the index; leftover rows would hide a rebuild that skips it.
        self.assertTrue(check_downgrade.index_trigger_present(self.data))
        check_downgrade.drop_index_trigger(self.data)
        self.assertFalse(check_downgrade.index_trigger_present(self.data))
        self.assertEqual(check_downgrade.index_rows(self.data), [])

    def test_schema_queries_work_with_older_sqlite(self):
        # sqlite_schema needs SQLite 3.33; sqlite_master works on every host.
        source = pathlib.Path(check_downgrade.__file__).read_text()
        self.assertNotIn('sqlite_schema', source)


class ContainerLogTest(unittest.TestCase):
    def test_saved_logs_are_not_fetched_again(self):
        fetched = []
        original = check_downgrade.docker_logs
        check_downgrade.docker_logs = lambda name: fetched.append(name) or f'fetched {name}'
        try:
            logs = {'stopped': '', 'started': None}
            self.assertEqual(check_downgrade.container_log(logs, 'stopped'), '')
            self.assertEqual(check_downgrade.container_log(logs, 'started'), 'fetched started')
            self.assertEqual(check_downgrade.container_log(logs, 'unknown'), 'fetched unknown')
        finally:
            check_downgrade.docker_logs = original
        self.assertEqual(fetched, ['started', 'unknown'])


class StartTest(unittest.TestCase):
    def test_env_is_passed_before_the_image(self):
        calls = []
        original = check_downgrade.docker, check_downgrade.wait_healthy
        check_downgrade.docker = lambda *args: calls.append(args) or ''
        check_downgrade.wait_healthy = lambda *args: None
        try:
            check_downgrade.start('n', 'scopearr:test', '/data-dir', 18090, env=('SCOPEARR_DEMO=true',))
            check_downgrade.start('n', 'scopearr:test', '/data-dir', 18090)
        finally:
            check_downgrade.docker, check_downgrade.wait_healthy = original
        with_env, without_env = calls
        self.assertEqual(with_env[-3:], ('-e', 'SCOPEARR_DEMO=true', 'scopearr:test'))
        self.assertEqual(without_env[:-3], with_env[:-5])
        self.assertEqual(without_env[-1], 'scopearr:test')
        self.assertNotIn('-e', without_env)


if __name__ == '__main__':
    unittest.main()
