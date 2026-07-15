import '@angular/compiler';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';
import { ChatbotService } from '../../src/app/services/chatbot.service';
import { AuthService } from '../../src/app/services/auth.service';
import { TauriService } from '../../src/app/services/tauri.service';

function setupService(isAdmin = false, activos: unknown[] = []) {
  const tauri = {
    getActivos: vi.fn().mockResolvedValue(activos),
    getAuditLog: vi.fn().mockResolvedValue([]),
    getKeywords: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    getCategorias: vi.fn().mockRejectedValue(new Error('DB unavailable')),
  } as unknown as TauriService;

  const auth = {
    currentUser: signal(isAdmin ? { id: 1, username: 'admin', rol: 'admin' } : { id: 2, username: 'user', rol: 'user' }),
    hasRole: vi.fn((role: string) => (role === 'admin' ? isAdmin : false)),
  } as unknown as AuthService;

  const svc = new ChatbotService(tauri, auth);
  svc.clearChat();
  return { tauri, auth, svc };
}

describe('Chatbot query parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects category filter for computadores', async () => {
    const { svc } = setupService(false, [
      { id: 1, codigo: 'PC-001', nombre: 'Computador Dell', categoria: 'Equipos de Cómputo', estado: 'operativo' },
      { id: 2, codigo: 'TV-001', nombre: 'Televisor LG', categoria: 'Equipos de Telecomunicaciones', estado: 'operativo' },
    ]);

    await svc.sendMessage('busco un computador');

    const msgs = svc.messages();
    const lastMsg = msgs[msgs.length - 1];

    expect(lastMsg.type).toBe('bot');
    expect(lastMsg.results?.totalCount).toBe(1);
    expect(lastMsg.results?.activos?.[0].nombre).toContain('Dell');
  });

  it('detects estado filter for fuera_de_servicio', async () => {
    const { svc } = setupService(false, [
      { id: 1, codigo: 'PC-001', nombre: 'PC Dañada', categoria: 'Equipos de Cómputo', estado: 'fuera_de_servicio' },
      { id: 2, codigo: 'PC-002', nombre: 'PC OK', categoria: 'Equipos de Cómputo', estado: 'operativo' },
    ]);

    await svc.sendMessage('muestra activos dañado');

    const msgs = svc.messages();
    const lastMsg = msgs[msgs.length - 1];

    // The default estadoMap maps "dañado" → "fuera_de_servicio"
    expect(lastMsg.results?.totalCount).toBe(1);
    expect(lastMsg.results?.activos?.[0].estado).toBe('fuera_de_servicio');
  });

  it('detects brand and pulgadas filters', async () => {
    const { svc } = setupService(false, [
      { id: 1, codigo: 'TV-001', nombre: 'TV LG 55', categoria: 'Equipos de Telecomunicaciones', estado: 'operativo' },
      { id: 2, codigo: 'TV-002', nombre: 'TV Samsung 50', categoria: 'Equipos de Telecomunicaciones', estado: 'operativo' },
    ]);

    await svc.sendMessage('necesito un televisor lg');

    const msgs = svc.messages();
    const lastMsg = msgs[msgs.length - 1];

    expect(lastMsg.results?.totalCount).toBe(1);
    expect(lastMsg.results?.activos?.[0].codigo).toBe('TV-001');
  });

  it('detects pulgadas filter from description', async () => {
    const { svc } = setupService(false, [
      { id: 1, codigo: 'TV-001', nombre: 'TV LG', categoria: 'Equipos de Telecomunicaciones', estado: 'operativo', descripcion: 'Pantalla 55 pulgadas' },
      { id: 2, codigo: 'TV-002', nombre: 'TV Samsung', categoria: 'Equipos de Telecomunicaciones', estado: 'operativo', descripcion: 'Pantalla 50 pulgadas' },
    ]);

    await svc.sendMessage('televisor de 55 pulgadas');

    const msgs = svc.messages();
    const lastMsg = msgs[msgs.length - 1];

    expect(lastMsg.results?.totalCount).toBe(1);
    expect(lastMsg.results?.activos?.[0].codigo).toBe('TV-001');
  });

  it('detects price range filter', async () => {
    const { svc } = setupService(false, [
      { id: 1, codigo: 'A-001', nombre: 'Laptop Barata', categoria: 'Equipos de Cómputo', valor_adquisicion: 300000 },
      { id: 2, codigo: 'A-002', nombre: 'Laptop Cara', categoria: 'Equipos de Cómputo', valor_adquisicion: 2000000 },
    ]);

    await svc.sendMessage('equipos con precio menor a 500000');

    const msgs = svc.messages();
    const lastMsg = msgs[msgs.length - 1];

    expect(lastMsg.results?.totalCount).toBe(1);
    expect(lastMsg.results?.activos?.[0].nombre).toContain('Barata');
  });

  it('for non-admin, audit query falls through to activos search', async () => {
    const { svc } = setupService(false, []);

    await svc.sendMessage('cuál fue el último login');

    const msgs = svc.messages();
    const lastMsg = msgs[msgs.length - 1];

    // Non-admin can't access audits; falls through to activos search with no results
    expect(lastMsg.results?.totalCount).toBe(0);
    expect(lastMsg.content).toContain('No encontré');
  });

  it('search with unknown terms returns all activos as fallback', async () => {
    const { svc } = setupService(false, [
      { id: 1, codigo: 'LAP-001', nombre: 'Laptop Dell Pro', categoria: 'Equipos de Cómputo', estado: 'operativo' },
      { id: 2, codigo: 'LAP-002', nombre: 'Laptop HP Elite', categoria: 'Equipos de Cómputo', estado: 'operativo' },
    ]);

    await svc.sendMessage('xyzzy noexiste');

    const msgs = svc.messages();
    const lastMsg = msgs[msgs.length - 1];

    expect(lastMsg.type).toBe('bot');
    // When no search criteria match, all activos are returned
    expect(lastMsg.results?.totalCount).toBe(2);
  });
});
