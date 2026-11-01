# Go server owns domain logic; TypeScript packages share only the API surface

The repo is a monorepo with a Go server, a Vite + React web app and an Expo (React Native) Android app. All domain logic lives in the Go server: Mastery scoring, building the Focus Set, putting together Practice Sessions, and generating Stories. The shared TypeScript packages contain only the API client and types, generated from an OpenAPI spec, plus UI-agnostic hooks and state. Web and mobile have separate UIs.

We did it this way so the logic is written once, in one language, and runs where the data and AI keys are. The alternative was sharing TypeScript domain logic between the two clients, which would leave the Go server as little more than storage and duplicate the rules if the server ever needs them.
