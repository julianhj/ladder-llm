import json

def validate_sample(sample):
    errors = []
    try:
        data = json.loads(sample)
    except json.JSONDecodeError as e:
        errors.append(f"Invalid JSON output: {str(e)}")
        return errors

    if "AssessmentResult" not in data:
        errors.append("Missing 'AssessmentResult' key in JSON output.")
        return errors

    ar = data["AssessmentResult"]
    required_keys = [
        "Strengths",
        "Concerns",
        "Recommendations",
        "InterviewQuestions",
        "MissingDataFlags"
    ]
    for key in required_keys:
        if key not in ar:
            errors.append(f"Missing key in AssessmentResult: {key}")
        else:
            if not isinstance(ar[key], list):
                errors.append(f"Key '{key}' should be a list.")

    return errors
