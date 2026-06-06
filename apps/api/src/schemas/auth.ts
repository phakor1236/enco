// Auth body schemas live in @app/shared so FE + API parse against the same
// source of truth. This file re-exports them for ergonomic local imports.
export { LoginBody, RegisterBody } from '@app/shared';
