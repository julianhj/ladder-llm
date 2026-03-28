import random

def generate_cv(config, idx=None):
    years_exp = random.randint(config['cv']['min_years_exp'], config['cv']['max_years_exp'])
    skills = random.sample(config['cv']['skill_categories'], k=2)
    industry = random.choice(config['cv']['industries'])
    education = random.choice(config['cv']['education_levels'])

    cv_text = (
        f"Name: Candidate {idx or 'X'}\n"
        f"Experience: {years_exp} years in {industry}\n"
        f"Skills: {', '.join(skills)}\n"
        f"Education: {education}\n"
        f"Summary: Proven track record in leadership and team development."
    )
    return cv_text
