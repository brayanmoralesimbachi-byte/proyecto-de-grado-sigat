import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/app/services/auth.service';
import { TauriService } from '../../src/app/services/tauri.service';

const createTauriServiceMock = () => ({
  login: vi.fn(),
  logout: vi.fn(),
} as unknown as TauriService);

describe('AuthService security', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores only the authenticated session payload and not raw credentials', async () => {
    const tauriService = createTauriServiceMock();
    vi.mocked(tauriService.login).mockResolvedValue({
      success: true,
      message: 'ok',
      user_id: 7,
      username: 'admin',
      rol: 'administrador',
      timezone: 'America/Bogota',
    });

    const service = new AuthService(tauriService);
    const response = await service.login('admin', 'SuperSecret123!');

    expect(response.success).toBe(true);
    expect(sessionStorage.getItem('currentUser')).toContain('admin');
    expect(sessionStorage.getItem('currentUser')).not.toContain('SuperSecret123!');
    expect(service.isAuthenticated()).toBe(true);
  });

  it('normalizes admin roles and clears session on logout', async () => {
    const tauriService = createTauriServiceMock();
    vi.mocked(tauriService.login).mockResolvedValue({
      success: true,
      message: 'ok',
      user_id: 7,
      username: 'admin',
      rol: 'administrador',
      timezone: 'America/Bogota',
    });

    const service = new AuthService(tauriService);
    await service.login('admin', 'SuperSecret123!');

    expect(service.hasRole('admin')).toBe(true);
    expect(service.hasRole('administrador')).toBe(true);

    await service.logout();

    expect(sessionStorage.getItem('currentUser')).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('does not persist session when login fails', async () => {
    const tauriService = createTauriServiceMock();
    vi.mocked(tauriService.login).mockResolvedValue({
      success: false,
      message: 'credenciales inválidas',
    });

    const service = new AuthService(tauriService);
    const response = await service.login('admin', 'WrongPassword');

    expect(response.success).toBe(false);
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser()).toBeNull();
    expect(sessionStorage.getItem('currentUser')).toBeNull();
  });

  it('returns login response in acceptable time with mocked backend', async () => {
    const tauriService = createTauriServiceMock();
    vi.mocked(tauriService.login).mockResolvedValue({
      success: true,
      message: 'ok',
      user_id: 1,
      username: 'perf-user',
      rol: 'admin',
      timezone: 'America/Bogota',
    });

    const service = new AuthService(tauriService);
    const start = performance.now();
    await service.login('perf-user', 'AnyPassword');
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(100);
  });

  it('sets blockedUntil when backend returns blocked_until on failed login', async () => {
    const tauriService = createTauriServiceMock();
    const future = new Date(Date.now() + 300000).toISOString();
    vi.mocked(tauriService.login).mockResolvedValue({
      success: false,
      message: 'Demasiados intentos. Intente de nuevo en 5 minutos.',
      blocked_until: future,
    });

    const service = new AuthService(tauriService);
    await service.login('target', 'wrong');

    expect(service.blockedUntil()).toBe(future);
    expect(service.remainingBlockSeconds()).toBeGreaterThan(0);
    expect(service.isAuthenticated()).toBe(false);
  });

  it('clears blocked state on successful login', async () => {
    const tauriService = createTauriServiceMock();
    const future = new Date(Date.now() + 300000).toISOString();

    vi.mocked(tauriService.login)
      .mockResolvedValueOnce({
        success: false,
        message: 'Demasiados intentos. Intente de nuevo en 5 minutos.',
        blocked_until: future,
      })
      .mockResolvedValueOnce({
        success: true,
        message: 'ok',
        user_id: 1,
        username: 'admin',
        rol: 'admin',
        timezone: 'America/Bogota',
      });

    const service = new AuthService(tauriService);
    await service.login('target', 'wrong');

    expect(service.blockedUntil()).toBeTruthy();

    await service.login('admin', 'correct');
    expect(service.blockedUntil()).toBeNull();
    expect(service.isAuthenticated()).toBe(true);
  });
});