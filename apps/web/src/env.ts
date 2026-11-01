/** Build-time configuration. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? 'http://localhost:8000/api/v1').replace(/\/$/, '')
export const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS === '1' || import.meta.env.VITE_USE_MOCKS === 'true'
