import { TauriService, BaseDatos } from '../../src/app/services/tauri.service';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('BasesDatosService security and behavior', () => {
  let service: TauriService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new TauriService();
  });

  it('getBasesDatos returns list of bases', async () => {
    const fakeBases: BaseDatos[] = [
      { id: 1, nombre: 'Sede Facatativá', descripcion: 'Principal' },
      { id: 2, nombre: 'Sede Bogotá', descripcion: 'Secundaria' },
    ];
    mockInvoke.mockResolvedValue(fakeBases);

    const result = await service.getBasesDatos();
    expect(result).toEqual(fakeBases);
    expect(mockInvoke).toHaveBeenCalledWith('get_bases_datos');
  });

  it('createBaseDatos creates and returns new id', async () => {
    mockInvoke.mockResolvedValue(42);
    const id = await service.createBaseDatos({ nombre: 'Nueva Sede' }, 1);
    expect(id).toBe(42);
    expect(mockInvoke).toHaveBeenCalledWith('create_base_datos', {
      baseDatos: { nombre: 'Nueva Sede', descripcion: undefined },
      userId: 1,
    });
  });

  it('updateBaseDatos succeeds', async () => {
    mockInvoke.mockResolvedValue('Base de datos actualizada exitosamente');
    const msg = await service.updateBaseDatos(1, { nombre: 'Editada' }, 1);
    expect(msg).toContain('actualizada');
  });

  it('deleteBaseDatos succeeds', async () => {
    mockInvoke.mockResolvedValue('Base de datos eliminada exitosamente');
    const msg = await service.deleteBaseDatos(5, 1);
    expect(msg).toContain('eliminada');
  });

  it('getUserBasesDatos returns assigned bases for a user', async () => {
    const fakeBases: BaseDatos[] = [
      { id: 1, nombre: 'Base A' },
    ];
    mockInvoke.mockResolvedValue(fakeBases);
    const result = await service.getUserBasesDatos(10);
    expect(result).toEqual(fakeBases);
    expect(mockInvoke).toHaveBeenCalledWith('get_user_bases_datos', { targetUserId: 10 });
  });

  it('assignUserToBaseDatos succeeds', async () => {
    mockInvoke.mockResolvedValue('Usuario asignado exitosamente');
    const msg = await service.assignUserToBaseDatos(10, 1, 99);
    expect(msg).toContain('asignado');
    expect(mockInvoke).toHaveBeenCalledWith('assign_user_to_base_datos', {
      targetUserId: 10,
      baseDatosId: 1,
      adminId: 99,
    });
  });

  it('unassignUserFromBaseDatos succeeds', async () => {
    mockInvoke.mockResolvedValue('Usuario desasignado exitosamente');
    const msg = await service.unassignUserFromBaseDatos(10, 1, 99);
    expect(msg).toContain('desasignado');
  });

  it('getAvailableBasesDatos returns bases not assigned to user', async () => {
    mockInvoke.mockResolvedValue([{ id: 2, nombre: 'Base Libre' }]);
    const result = await service.getAvailableBasesDatos(10);
    expect(result).toHaveLength(1);
    expect(result[0].nombre).toBe('Base Libre');
  });

  it('rejects when backend throws error', async () => {
    mockInvoke.mockRejectedValue(new Error('No se puede eliminar: tiene activos asociados'));
    await expect(service.deleteBaseDatos(1, 1)).rejects.toThrow('activos asociados');
  });
});
