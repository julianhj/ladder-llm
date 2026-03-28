import os
import yaml
import json
import random
from modules.cv_generator import generate_cv
from modules.jd_generator import generate_job_description
from modules.assistant_output_generator import generate_assistant_output
from modules.validator import validate_sample

CONFIG_PATH = os.path.join("config", "settings.yaml")
RULES_PATH = os.path.join("config", "base_rules.md")
OUTPUT_DIR = os.path.join("output", "examples")
JSONL_PATH = os.path.join("output", "train.jsonl")
LOG_DIR = os.path.join("output", "logs")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

def main():
    # Load config
    with open(CONFIG_PATH, "r") as f:
        config = yaml.safe_load(f)

    # Load formatting rules (system prompt)
    with open(RULES_PATH, "r") as f:
        base_rules = f.read()

    num_samples = config.get("num_samples", 100)
    random_seed = config.get("random_seed", None)
    if random_seed is not None:
        random.seed(random_seed)

    print(f"Generating {num_samples} training samples...")

    with open(JSONL_PATH, "w", encoding="utf-8") as jsonl:
        for i in range(num_samples):
            cv = generate_cv(config, idx=i)
            jd = generate_job_description(config)
            assistant_out = generate_assistant_output(cv, jd, base_rules, idx=i)

            # Validation
            errors = validate_sample(assistant_out)
            if errors:
                print(f"[WARN] Sample {i} failed validation: {errors}")

            # JSONL formatting
            record = {
                "messages": [
                    {"role": "system", "content": base_rules},
                    {"role": "user", "content": f"CV:\n{cv}\n\nJob Description:\n{jd}"},
                    {"role": "assistant", "content": assistant_out}
                ]
            }

            jsonl.write(json.dumps(record, ensure_ascii=False) + "\n")

            # Save example for review
            with open(os.path.join(OUTPUT_DIR, f"sample_{i+1}.txt"), "w", encoding="utf-8") as f:
                f.write("=== CV ===\n")
                f.write(cv + "\n\n=== JD ===\n")
                f.write(jd + "\n\n=== Assistant Output ===\n")
                f.write(assistant_out)

    print(f"Dataset created at {JSONL_PATH}")

if __name__ == "__main__":
    main()
