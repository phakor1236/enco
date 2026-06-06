import axios, { type AxiosInstance } from 'axios';

/**
 * Single shared Axios instance. Base URL is `/api` so that:
 *  - Dev: Vite proxy in vite.config.ts forwards /api/* to the API origin
 *  - Prod: Vercel rewrites forward /api/* to the deployed API origin
 * Result: FE always looks same-origin -> SameSite=Lax cookies work.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15_000,
});
