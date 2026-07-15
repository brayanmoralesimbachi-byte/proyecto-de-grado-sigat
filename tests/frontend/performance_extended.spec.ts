import '@angular/compiler';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthService } from '../../src/app/services/auth.service';
import { TauriService } from '../../src/app/services/tauri.service';
import { ChatbotService } from '../../src/app/services/chatbot.service';

const createTauriAuthMock = () => ({
  login: vi.fn(),
  logout: vi.fn(),
  getAvailableBasesDatos: vi.fn(),
} as unknown as TauriService);

const createTauriChatMock = () => ({
  getActivos: vi.fn(),
  getAuditLog: vi.fn(),
  getKeywords: vi.fn().mockResolvedValue([]),
  getCategorias: vi.fn().mockResolvedValue([]),
} as unknown as TauriService);

const createAuthMock = () => ({
  currentUser: { id: 1, username: 'admin', rol: 'admin' },
  hasRole: vi.fn(() => true),
} as unknown as AuthService);

describe('Extended performance thresholds', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('login handles 100 concurrent mock calls under 500ms', async () => {
    const tauri = createTauriAuthMock();
    vi.mocked(tauri.login).mockResolvedValue({
      success: true, message: 'ok', user_id: 1, username: 'perf', rol: 'admin', timezone: 'America/Bogota',
    });

    const service = new AuthService(tauri);
    const start = performance.now();

    const calls = Array.from({ length: 100 }, () => service.login('user', 'pass'));
    await Promise.all(calls);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(tauri.login).toHaveBeenCalledTimes(100);
  });

  it('chatbot search handles 50 concurrent queries under 1000ms', async () => {
    const tauri = createTauriChatMock();
    vi.mocked(tauri.getActivos).mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({
        id: i + 1,
        codigo: `ACT-${i}`,
        nombre: i % 2 === 0 ? `Computador ${i}` : `Televisor ${i}`,
        categoria: i % 2 === 0 ? 'Equipos de Cómputo' : 'Equipos de Telecomunicaciones',
        estado: 'operativo',
      }))
    );

    const auth = createAuthMock();
    const service = new ChatbotService(tauri, auth);
    service.clearChat();

    const start = performance.now();
    const queries = Array.from({ length: 50 }, (_, i) =>
      service.sendMessage(i % 2 === 0 ? 'busco computador' : 'muestra televisor')
    );
    await Promise.all(queries);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it('getAvailableBasesDatos resolves under 50ms', async () => {
    const tauri = createTauriAuthMock();
    vi.mocked(tauri.getAvailableBasesDatos).mockResolvedValue([
      { id: 1, nombre: 'Base A' },
      { id: 2, nombre: 'Base B' },
    ]);

    const service = new AuthService(tauri);
    sessionStorage.setItem('currentUser', JSON.stringify({ id: 1, username: 'admin', rol: 'admin' }));
    service['loadUserFromStorage']();

    const start = performance.now();
    await service.loadAvailableBases();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(service.availableBases()).toHaveLength(2);
  });

  it('auth service hasRole check stays under 0.1ms', () => {
    const tauri = createTauriAuthMock();
    const service = new AuthService(tauri);

    sessionStorage.setItem('currentUser', JSON.stringify({ id: 1, username: 'admin', rol: 'admin' }));
    service['loadUserFromStorage']();

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      service.hasRole('admin');
      service.hasRole('user');
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
  });
});
