import pathlib
import re
import unittest

WORKFLOWS = pathlib.Path(__file__).resolve().parent.parent / '.github' / 'workflows'


def read(name):
    return (WORKFLOWS / name).read_text()


def trigger_block(text, event):
    """Return the indented lines belonging to `event:` under the top-level `on:` key."""
    lines = text.splitlines()
    on_index = next(i for i, line in enumerate(lines) if re.match(r'''^["']?on["']?\s*:''', line))
    block = []
    for line in lines[on_index + 1:]:
        if line.strip() and not line.startswith((' ', '\t')):
            break
        block.append(line)
    for i, line in enumerate(block):
        if re.match(rf'^\s+{event}\s*:', line):
            indent = len(line) - len(line.lstrip())
            body = [line]
            for rest in block[i + 1:]:
                if rest.strip() and len(rest) - len(rest.lstrip()) <= indent:
                    break
                body.append(rest)
            return '\n'.join(body)
    return None


class WorkflowGuardTest(unittest.TestCase):
    def test_ci_runs_on_release_branches(self):
        text = read('ci.yml')
        push = trigger_block(text, 'push')
        self.assertIsNotNone(push)
        match = re.search(r'branches\s*:\s*\[(.*?)\]', push)
        self.assertIsNotNone(match)
        branches = [b.strip().strip('"\'') for b in match.group(1).split(',')]
        self.assertIn('main', branches)
        self.assertIn('release/**', branches)
        self.assertIsNotNone(trigger_block(text, 'pull_request'))

    def test_release_workflow_stays_main_only(self):
        text = read('release.yml')
        self.assertRegex(text, r'''if:\s*github\.ref\s*==\s*['"]refs/heads/main['"]''')
        self.assertIsNotNone(trigger_block(text, 'workflow_dispatch'))
        self.assertIsNone(trigger_block(text, 'push'))

    def test_stable_tag_only_in_release_workflow(self):
        for path in sorted(WORKFLOWS.glob('*.y*ml')):
            if path.name == 'release.yml':
                continue
            self.assertNotIn(':stable', path.read_text(), path.name)


if __name__ == '__main__':
    unittest.main()
