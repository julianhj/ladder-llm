import random

def generate_job_description(config):
    role = random.choice(config['job_description']['roles'])
    num_reqs = random.randint(config['job_description']['min_requirements'], config['job_description']['max_requirements'])
    requirements = [f"Requirement {i+1} for {role}" for i in range(num_reqs)]

    jd_text = (
        f"Role: {role}\n"
        f"Requirements:\n" +
        "\n".join(f"- {req}" for req in requirements)
    )
    return jd_text
