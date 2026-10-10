"""Mastery → difficulty resolution (FR-A8 feeding FR-A5/FR-A6)."""

from app.core.mastery import average_mastery, mastery_guidance, resolve_depth


class TestResolveDepth:
    def test_beginner_below_55(self):
        assert resolve_depth(0) == "beginner"
        assert resolve_depth(54.99) == "beginner"

    def test_intermediate_mid_band(self):
        assert resolve_depth(55) == "intermediate"
        assert resolve_depth(79.99) == "intermediate"

    def test_advanced_at_or_above_80(self):
        assert resolve_depth(80) == "advanced"
        assert resolve_depth(100) == "advanced"

    def test_defaults_to_intermediate_when_unknown(self):
        assert resolve_depth(None) == "intermediate"
        assert resolve_depth("n/a") == "intermediate"


class TestAverageMastery:
    def test_none_when_no_rows(self):
        assert average_mastery([]) is None

    def test_mean_of_rows(self):
        rows = [{"mastery_score": 40}, {"mastery_score": 90}]
        assert average_mastery(rows) == 65.0

    def test_treats_missing_scores_as_zero(self):
        rows = [{"mastery_score": None}, {"mastery_score": 100}]
        assert average_mastery(rows) == 50.0


class TestMasteryGuidance:
    def test_empty_without_rows(self):
        assert mastery_guidance([]) == ""

    def test_names_weakest_topics(self):
        rows = [
            {"module_title": "Sorting", "mastery_score": 32},
            {"module_title": "Graphs", "mastery_score": 48},
            {"module_title": "Hashing", "mastery_score": 91},
        ]
        guidance = mastery_guidance(rows)
        assert "Sorting 32%" in guidance
        assert "Graphs 48%" in guidance
        assert "strongest topic: Hashing" in guidance

    def test_omits_strongest_when_none_is_strong(self):
        rows = [{"module_title": "Basics", "mastery_score": 20}]
        guidance = mastery_guidance(rows)
        assert "Basics 20%" in guidance
        assert "strongest" not in guidance
