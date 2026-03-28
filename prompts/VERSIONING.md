# Prompt and Configuration Versioning Strategy

This document describes the versioning strategy for prompt files and agent configurations.

## Overview

All prompt files and the agents configuration file use semantic versioning (semver) format: `major.minor.patch` (e.g., `1.0.0`, `2.1.3`).

**Version-based file naming**: Each version of a prompt is stored as a separate file with the version in the filename. This allows multiple versions to coexist and provides deterministic version selection.

## Prompt File Versioning

### File Naming Format

Prompt files are YAML and named with the version embedded in the filename:

```
{base_path}.v{version}.yaml
```

**Examples:**
- `stage_3_interviews/technical_interviewer.v2.0.3.yaml`
- `stage_14_consensus_decision/agent_alignment_overview.v1.0.0.yaml`
- `stage_15_final_decision/evidence_integration.v1.0.4.yaml`

Superseded files may live under `prompts/old/` for reference only; `agents.json` must reference files under stage folders (or preprocessing) that exist beside `old/`.

### Benefits of Filename-Based Versioning

1. **Deterministic**: The exact file to load is determined by the version in config
2. **Multiple versions coexist**: You can have `v1.0.0`, `v1.1.0`, `v2.0.0` all in the same directory
3. **Easy rollback**: Change version in config to use a different file
4. **Clear versioning**: Version is visible in the filename, no need to parse metadata
5. **Git-friendly**: File renames show version history clearly

### Version Bumping Guidelines

- **Major version** (X.0.0): Breaking changes that affect agent behavior or output schema
- **Minor version** (0.X.0): New features, significant improvements, or additions to capabilities
- **Patch version** (0.0.X): Bug fixes, minor corrections, or formatting changes

### YAML structure

Each prompt file is a YAML object with optional top-level metadata (`version`, `lastModified`, `description`) and a required `prompt` field. **The `prompt` field must be a structured object**, not a raw string. The loader renders this object to a single string for the model. Use keys such as `role`, `objective`, `inputs`, `rules`, `output_requirements`, `output_schema`, `final_instruction` (and other section keys as needed). Do not use `prompt: |` with a free-form text blob.

Example:

```yaml
version: "1.2.0"
lastModified: "2024-11-15"
description: "Added new assessment framework section"

prompt:
  role: "Evidence Integration Specialist"
  objective: >
    Validate all evidence signals from structuredCV and signal_layer.
    Output must be valid, deterministic JSON matching the schema.
  inputs:
    structuredCV_summary_keywords: "CV summary keywords (if present)"
    signal_layer: "Calibrated signals and evidence_items"
  rules:
    - "Extract only signals explicitly supported by evidence_items."
  output_requirements:
    format: "JSON only"
    constraints:
      - "Do not add padding or extra text after the closing brace."
  final_instruction: "No other text before or after the JSON."
```

Output schemas are not defined in prompt YAML; they are defined in Zod (schema registry) and injected as JSON schema at runtime.

See `prompts/README.md` and `stage_15_final_decision/evidence_integration.v1.0.0.yaml` for the full structure. Utilities: `parsePromptYaml(content)` returns `{ metadata, prompt }` where `prompt` is the rendered string; `renderStructuredPrompt(promptObj)` turns the structured object into that string.

## Agent Configuration Versioning

### Config File Format

The `agents.json` configuration file includes version metadata at the root level:

```json
{
  "version": "1.0.0",
  "lastModified": "2024-11-06",
  "stages": [
    ...
  ]
}
```

### Agent Configuration Format

Each agent specifies a `promptBase` (path without version) and a `version`:

```json
{
  "name": "Technical Interviewer",
  "promptBase": "interviewers/technical_interviewer",
  "version": "1.0.0",
  "outputSchema": "assessment",
  ...
}
```

The system will:
- Construct the filename as `{promptBase}.v{version}.yaml`
- Load the file and parse YAML to get the `prompt` body
- Validate that the version in the filename (and optionally in the YAML) matches the config version
- Log warnings if there's a mismatch

## Version Validation

The system automatically:
1. Constructs the file path from `promptBase` + `version` in config
2. Validates the version format (must be semver: `major.minor.patch`)
3. Extracts version from the filename and verifies it matches config
4. Logs version information for debugging and tracking
5. Throws an error if the file doesn't exist or version format is invalid

## Version Checking

Version information is logged at:
- **DEBUG level**: When versions match or metadata is found
- **WARN level**: When version mismatches occur or expected version is specified but metadata is missing

## Migration Guide

### Creating a New Version

1. Copy the existing versioned file to a new version:
   ```bash
   cp stage_3_interviews/technical_interviewer.v2.0.0.yaml stage_3_interviews/technical_interviewer.v2.1.0.yaml
   ```

2. Make your changes to the new file

3. Update the config to use the new version:
   ```json
   {
     "name": "Technical Interviewer",
     "promptBase": "interviewers/technical_interviewer",
     "version": "1.1.0",  // ← Updated version
     ...
   }
   ```

### Updating Versions

1. Determine the type of change (major/minor/patch)
2. Create a new file with the incremented version number
3. Make your changes in the new file
4. Update the `version` field in `agents.json` to point to the new version
5. Test the new version
6. Keep old versions for rollback if needed

### Example Workflow

**Before:**
- File: `stage_3_interviews/technical_interviewer.v2.0.0.yaml`
- Config: `"version": "2.0.0"`

**After minor update:**
- Create: `stage_3_interviews/technical_interviewer.v2.1.0.yaml` (with changes)
- Update config: `"version": "2.1.0"`
- Old file `v2.0.0.yaml` remains for rollback

## Best Practices

1. **Always use versioned filenames**: Name files as `{base}.v{version}.yaml` from the start
2. **Create new files for new versions**: Don't modify existing versioned files
3. **Keep old versions**: Retain previous versions for rollback and comparison
4. **Update config when changing versions**: Always update the `version` field in `agents.json`
5. **Use semantic versioning correctly**:
   - **Major** (X.0.0): Breaking changes, incompatible updates
   - **Minor** (0.X.0): New features, backward-compatible additions
   - **Patch** (0.0.X): Bug fixes, minor corrections
6. **Test before switching**: Test new versions before updating config
7. **Document changes**: Consider adding a CHANGELOG.md for significant version changes

## Version Utilities

The versioning system provides utilities in `src/utils/PromptVersion.ts`:

- `constructPromptFilePath(promptBase, version)`: Constructs versioned YAML file path
- `parsePromptYaml(content)`: Parses YAML and returns `{ metadata, prompt }` (if `prompt` is an object, it is rendered to a string via `renderStructuredPrompt`)
- `extractVersionFromFilename(filename)`: Extracts version from filename
- `getPromptBaseFromFilename(filename)`: Gets base path from versioned filename
- `isValidVersion(version)`: Validates version format (semver)
- `compareVersions(v1, v2)`: Compares two semantic versions

## Notes

- **Version is required**: The `version` field in config is mandatory
- **File must exist**: The system will throw an error if the versioned file doesn't exist
- **Version format validation**: Invalid version formats will cause initialization to fail
- **Deterministic loading**: The exact file loaded is always `{promptBase}.v{version}.yaml`
- **Multiple versions**: You can have multiple versions of the same prompt in the same directory
- **Easy rollback**: Change the `version` in config to use a different file

## Evidence Policy Guidance

- Interviews and CV optimisation prompts should **integrate** summary, skills, experience, and selected missing skills with **role-relevant judgment**. Do not default to treating listed skills as low-trust compared with experience unless inputs clearly conflict.
- Keep strict risk handling for **unsupported high-impact claims** (scope, authority, seniority, large impact).

