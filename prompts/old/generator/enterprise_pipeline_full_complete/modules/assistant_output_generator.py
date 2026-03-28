import json
import random

def generate_assistant_output(cv, jd, rules, idx=None):
    # For demo purposes: generate plausible structured JSON with lists
    strengths = [
        "Strong strategic thinking demonstrated in past roles.",
        "High executive presence and leadership impact."
    ]
    concerns = [
        "Limited documented experience in change management.",
        "Some gaps in coaching skill evidence."
    ]
    recommendations = [
        "Develop expertise in change management through training.",
        "Prepare examples demonstrating coaching impact."
    ]
    interview_questions = [
        "Describe your vision for leading a cross-functional team.",
        "Give an example of how you handled a difficult decision."
    ]
    missing_data_flags = []

    # Example check for missing data (very simple heuristic)
    if "Education:" not in cv:
        missing_data_flags.append("Education details missing in CV.")
    if "Requirements:" not in jd:
        missing_data_flags.append("Job requirements missing in Job Description.")

    assessment = {
        "AssessmentResult": {
            "Strengths": strengths,
            "Concerns": concerns,
            "Recommendations": recommendations,
            "InterviewQuestions": interview_questions,
            "MissingDataFlags": missing_data_flags
        }
    }
    # Output JSON string only (no extra text)
    return json.dumps(assessment, indent=2)
