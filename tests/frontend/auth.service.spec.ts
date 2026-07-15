import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthService } from '../../src/app/services/auth.service';
import { TauriService } from '../../src/app/services/tauri.service';

const createTauriMock = () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getAvailableBasesDatos: vi.fn(),
} as unknown as TauriService);

describe('AuthService', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('hasRole normalizes admin/administrador equivalence', () => {
    const tauri = createTauriMock();
    const service = new AuthService(tauri);

    sessionStorage.setItem('currentUser', JSON.stringify({ id: 1, username: 'admin', rol: 'administrador' }));
    service['loadUserFromStorage']();

    expect(service.hasRole('admin')).toBe(true);
    expect(service.hasRole('administrador')).toBe(true);
    expect(service.hasRole('user')).toBe(false);
  });

  it('hasRole returns false when no user is logged in', () => {
    const tauri = createTauriMock();
    const service = new AuthService(tauri);

    expect(service.hasRole('admin')).toBe(false);
    expect(service.hasRole('user')).toBe(false);
  });

  it('loadAvailableBases sets selectedBaseDatosId when only one base', async () => {
    const tauri = createTauriMock();
    vi.mocked(tauri.getAvailableBasesDatos).mockResolvedValue([{ id: 5, nombre: 'Sede Única' }]);
    const service = new AuthService(tauri);

    sessionStorage.setItem('currentUser', JSON.stringify({ id: 1, username: 'user', rol: 'user' }));
    service['loadUserFromStorage']();

    await service.loadAvailableBases();

    expect(service.selectedBaseDatosId()).toBe(5);
    expect(service.hasSingleBase()).toBe(true);
    expect(service.hasMultipleBases()).toBe(false);
  });

  it('loadAvailableBases sets null when multiple bases', async () => {
    const tauri = createTauriMock();
    vi.mocked(tauri.getAvailableBasesDatos).mockResolvedValue([
      { id: 1, nombre: 'Base A' },
      { id: 2, nombre: 'Base B' },
    ]);
    const service = new AuthService(tauri);

    sessionStorage.setItem('currentUser', JSON.stringify({ id: 1, username: 'user', rol: 'user' }));
    service['loadUserFromStorage']();

    await service.loadAvailableBases();

    expect(service.selectedBaseDatosId()).toBeNull();
    expect(service.hasMultipleBases()).toBe(true);
    expect(service.hasSingleBase()).toBe(false);
  });

  it('updateUserTimezone persists to sessionStorage', () => {
    const tauri = createTauriMock();
    const service = new AuthService(tauri);

    sessionStorage.setItem('currentUser', JSON.stringify({ id: 1, username: 'admin', rol: 'admin' }));
    service['loadUserFromStorage']();

    service.updateUserTimezone('America/New_York');

    const stored = JSON.parse(sessionStorage.getItem('currentUser')!);
    expect(stored.timezone).toBe('America/New_York');
    expect(service.currentUser()?.timezone).toBe('America/New_York');
  });

  it('logout clears state and sessionStorage', async () => {
    const tauri = createTauriMock();
    vi.mocked(tauri.logout).mockResolvedValue('ok');
    const service = new AuthService(tauri);

    sessionStorage.setItem('currentUser', JSON.stringify({ id: 1, username: 'admin', rol: 'admin', loginTimestamp: '2024-01-01T00:00:00Z' }));
    service['loadUserFromStorage']();

    await service.logout();

    expect(tauri.logout).toHaveBeenCalled();
    expect(sessionStorage.getItem('currentUser')).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.currentUser()).toBeNull();
  });
});
