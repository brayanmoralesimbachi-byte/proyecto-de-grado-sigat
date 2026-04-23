import '@angular/compiler';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthService } from '../../src/app/services/auth.service';
import { TauriService } from '../../src/app/services/tauri.service';
import { ChatbotService } from '../../src/app/services/chatbot.service';
import { AuthService as AuthServiceType } from '../../src/app/services/auth.service';
import { ActivosComponent } from '../../src/app/components/activos/activos.component';
import { Router } from '@angular/router';

const createAuthTauriMock = () => ({
  login: vi.fn(),
  logout: vi.fn(),
} as unknown as TauriService);

const createChatbotTauriMock = () => ({
  getActivos: vi.fn(),
  getAuditLog: vi.fn(),
  getKeywords: vi.fn(),
  getCategorias: vi.fn(),
} as unknown as TauriService);

const createChatAuthMock = (isAdmin = false) => ({
  hasRole: vi.fn((role: string) => (role === 'admin' ? isAdmin : false)),
} as unknown as AuthServiceType);

describe('Security performance thresholds', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('login flow responds under 80ms with mocked backend', async () => {
    const tauri = createAuthTauriMock();
    vi.mocked(tauri.login).mockResolvedValue({
      success: true,
      message: 'ok',
      user_id: 1,
      username: 'perf-user',
      rol: 'admin',
      timezone: 'America/Bogota',
    });

    const service = new AuthService(tauri);
    const start = performance.now();
    await service.login('perf-user', 'safe-pass');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(80);
  });

  it('chatbot search responds under 250ms for small dataset', async () => {
    const tauri = createChatbotTauriMock();
    vi.mocked(tauri.getKeywords).mockResolvedValue([]);
    vi.mocked(tauri.getCategorias).mockResolvedValue([]);
    vi.mocked(tauri.getActivos).mockResolvedValue([
      {
        id: 100,
        codigo: 'LAP-100',
        nombre: 'Laptop Dell 14',
        categoria: 'Equipos de Cómputo',
        estado: 'operativo',
      },
    ]);

    const auth = createChatAuthMock(false);
    const service = new ChatbotService(tauri, auth);

    const start = performance.now();
    await service.sendMessage('busco laptop dell');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(250);
    expect(service.isProcessing()).toBe(false);
  });

  it('image upload transformation to base64 stays under 80ms', () => {
    const tauri = {
      getCategorias: vi.fn(),
      getActivos: vi.fn(),
    } as unknown as TauriService;
    const auth = {
      currentUser: vi.fn(() => ({ id: 1, username: 'admin', rol: 'admin' })),
      hasRole: vi.fn(() => true),
    } as unknown as AuthServiceType;
    const router = { navigate: vi.fn() } as unknown as Router;
    const component = new ActivosComponent(tauri, auth, router);

    class FileReaderMock {
      result: string | ArrayBuffer | null = 'data:image/png;base64,ZmFrZS1kYXRh';
      onload: null | (() => void) = null;

      readAsDataURL(_file: File): void {
        if (this.onload) {
          this.onload();
        }
      }
    }

    vi.stubGlobal('FileReader', FileReaderMock as unknown as typeof FileReader);

    const file = { size: 1024, type: 'image/png' } as File;
    const event = { target: { files: [file] } } as unknown as Event;

    const start = performance.now();
    component.onImageSelect(event);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(80);
    expect(component.currentActivo().imagen_base64).toContain('data:image/png;base64');
  });
});
