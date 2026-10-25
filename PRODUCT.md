# Doctopus product context

Doctopus is a self-hosted API documentation product. The name and violet octopus branding were selected by the project owner.

## People and tasks

- API consumers read guides, inspect endpoint contracts, copy examples and try requests.
- Documentation maintainers load YAML/JSON API specifications and integrate through framework plugins, including Java/Spring Boot and JavaScript runtimes.
- Operators use Studio to manage projects, builds, publications, access and audit history.

## Platform and constraints

The reader and Studio are React web applications in a TypeScript workspace. Existing framework integrations, CLI commands, routes and API contracts remain supported. A Spring integration can serve the documentation UI without Studio.

Documentation supports static hosting. The public GitHub Pages demo generates mock responses locally and must never call an API server. Studio uses the authenticated administration service. Credentials remain subject to the existing session, scope and storage policies.

Keep prepared appearance themes, system/light/dark modes, the classic reference option, resizable panes, keyboard access, localization, request serialization, uploads, OAuth and clipboard behavior working. Response editor appearance follows the selected documentation theme.

## Current design brief

The owner requests a comprehensive Mintlify-like overhaul of every application surface, including Studio. The visual reference is <https://mint.mintlify.app/api-reference/endpoint/> and the supplied Create Plant screenshot. Preserve Doctopus product identity and existing functionality while closely matching the reference's layout and craft.

The owner also requests Impeccable for this work. Its published design guidance informs the redesign, visual review and accessibility/responsive checks. The supplied visual target takes precedence over generic style preferences.

## Delivery

Use conventional commits and push completed steps. Merge after the required pipeline and browser checks pass, then verify the main pipeline and public demo deployment. Package publication is separate from UI delivery.
