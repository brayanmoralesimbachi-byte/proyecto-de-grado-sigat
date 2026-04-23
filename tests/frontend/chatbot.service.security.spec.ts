import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatbotService } from '../../src/app/services/chatbot.service';
import { AuthService } from '../../src/app/services/auth.service';
import { TauriService } from '../../src/app/services/tauri.service';

const createTauriMock = () => ({
  getActivos: vi.fn(),
  getAuditLog: vi.fn(),
  getKeywords: vi.fn(),
  getCategorias: vi.fn(),
} as unknown as TauriService);

const createAuthMock = (isAdmin: boolean) => ({
  hasRole: vi.fn((role: string) => (role === 'admin' ? isAdmin : false)),
} as unknown as AuthService);

describe('ChatbotService security and behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps admin audit data inaccessible for non-admin users', async () => {
    const tauri = createTauriMock();
    vi.mocked(tauri.getKeywords).mockResolvedValue([]);
    vi.mocked(tauri.getCategorias).mockResolvedValue([]);
    vi.mocked(tauri.getActivos).mockResolvedValue([]);

    const auth = createAuthMock(false);
    const service = new ChatbotService(tauri, auth);

    await service.loadData();
    const exportData = await service.getAllAuditsForExport();

    expect(exportData).toEqual([]);
    expect(tauri.getAuditLog).not.toHaveBeenCalled();
  });

  it('responds to user search with bot message and result payload', async () => {
    const tauri = createTauriMock();
    vi.mocked(tauri.getKeywords).mockResolvedValue([]);
    vi.mocked(tauri.getCategorias).mockResolvedValue([]);
    vi.mocked(tauri.getActivos).mockResolvedValue([
      {
        id: 10,
        codigo: 'TV-001',
        nombre: 'Televisor LG 55',
        categoria: 'Equipos de Telecomunicaciones',
        estado: 'operativo',
        descripcion: 'Pantalla de 55 pulgadas',
      },
    ]);

    const auth = createAuthMock(false);
    const service = new ChatbotService(tauri, auth);

    const start = performance.now();
    await service.sendMessage('busco televisor lg de 55 pulgadas');
    const elapsedMs = performance.now() - start;

    const messages = service.messages();
    const lastMessage = messages[messages.length - 1];

    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(lastMessage.type).toBe('bot');
    expect(lastMessage.results?.totalCount).toBeGreaterThan(0);
    expect(service.isProcessing()).toBe(false);
    expect(elapsedMs).toBeLessThan(200);
  });
});