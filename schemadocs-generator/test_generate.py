# Copyright (c) 2026 CoLLMate, Inc.
# SPDX-License-Identifier: Apache-2.0
"""Regression checks for the generated specification and usage guides."""

import unittest
from pathlib import Path

from generate import ExtendedSRSGenerator


class GeneratedDocumentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        cls.generator = ExtendedSRSGenerator(str(root / 'schema/extended-srs-schema.json'))
        cls.spec = cls.generator.generate()
        cls.guides = cls.generator.generate_all_usage_guides()

    def test_section_numbers_match_the_parent_chapter(self):
        self.assertIn('### IV.1. ', self.spec)
        self.assertIn('### IV.10. ', self.spec)

    def test_shared_status_and_dependencies_are_described(self):
        guide = self.guides['functional-requirements']
        self.assertIn('status: "draft"/"tentative"/"approved"', guide)
        self.assertIn('依存先', guide)
        self.assertIn('"string" | object', guide)

    def test_shared_review_definitions_are_expanded(self):
        structure = self.guides['workflow'].split('## YAML構造', 1)[1].split('```', 2)[1]
        self.assertIn('decision_id:', structure)
        self.assertIn('decided_by:', structure)
        self.assertIn('gate_id: "string"  # ✅', structure)

    def test_structure_is_identified_as_pseudocode(self):
        self.assertNotIn('```yaml\n@srs:', self.spec)
        for guide in self.guides.values():
            self.assertIn('型と構造を示す擬似表記', guide)
            self.assertNotIn('```yaml\n@srs:', guide)

    def test_embedded_schemas_are_documented_without_expanding_the_recursive_meta_schema(self):
        guide = self.guides['system-architecture']
        self.assertIn('error_response_format: object | boolean', guide)
        self.assertIn('JSON Schema Draft 7', guide)
        self.assertIn('参照先', guide)
        self.assertNotIn('Core schema meta-schema', guide)
        self.assertNotIn('http:/json-schema.org', guide)


if __name__ == '__main__':
    unittest.main()
