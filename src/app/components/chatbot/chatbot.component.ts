import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FormatMarkdownPipe } from '../../pipes/format-markdown.pipe';
import { AuthService } from '../../services/auth.service';
import { ChatbotService, SearchResults } from '../../services/chatbot.service';
import { Activo, AuditLog } from '../../services/tauri.service';

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule, FormsModule, FormatMarkdownPipe],
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.scss']
})
export class ChatbotComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('messageInput') private messageInput!: ElementRef;

  isOpen = signal(false);
  inputMessage = '';
  
  // Paginación de resultados
  currentResultPage = signal(1);
  resultsPerPage = 5;
  
  // Modal de imagen
  showImageModal = signal(false);
  selectedImage = signal<string | null>(null);
  selectedImageName = signal('');

  // Para exportar auditorías
  showExportModal = signal(false);
  exportConfig = signal({
    allData: true,
    fechaDesde: '',
    fechaHasta: '',
    categorias: {
      LOGIN: true,
      LOGOUT: true,
      CREATE: true,
      UPDATE: true,
      DELETE: true
    }
  });
  isExporting = signal(false);

  constructor(
    public chatbotService: ChatbotService,
    public authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.chatbotService.loadData();
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  toggleChat(): void {
    this.isOpen.update(v => !v);
    if (this.isOpen()) {
      setTimeout(() => {
        this.messageInput?.nativeElement?.focus();
      }, 100);
    }
  }

  closeChat(): void {
    this.isOpen.set(false);
  }

  async sendMessage(): Promise<void> {
    if (!this.inputMessage.trim() || this.chatbotService.isProcessing()) return;
    
    const message = this.inputMessage;
    this.inputMessage = '';
    this.currentResultPage.set(1);
    
    await this.chatbotService.sendMessage(message);
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.messagesContainer) {
        this.messagesContainer.nativeElement.scrollTop = 
          this.messagesContainer.nativeElement.scrollHeight;
      }
    } catch (err) {}
  }

  clearChat(): void {
    this.chatbotService.clearChat();
    this.currentResultPage.set(1);
  }

  // Paginación de resultados
  getDisplayedActivos(results: SearchResults | undefined, showAll: boolean): Activo[] {
    if (!results?.activos) return [];
    
    if (showAll) {
      const start = (this.currentResultPage() - 1) * this.resultsPerPage;
      const end = start + this.resultsPerPage;
      return results.activos.slice(start, end);
    }
    
    return results.activos.slice(0, 5);
  }

  getDisplayedAudits(results: SearchResults | undefined): AuditLog[] {
    if (!results?.audits) return [];
    return results.audits.slice(0, 10);
  }

  getTotalResultPages(results: SearchResults | undefined): number {
    if (!results?.activos) return 1;
    return Math.ceil(results.activos.length / this.resultsPerPage);
  }

  nextResultPage(results: SearchResults | undefined): void {
    const totalPages = this.getTotalResultPages(results);
    if (this.currentResultPage() < totalPages) {
      this.currentResultPage.update(p => p + 1);
    }
  }

  prevResultPage(): void {
    if (this.currentResultPage() > 1) {
      this.currentResultPage.update(p => p - 1);
    }
  }

  goToResultPage(page: number): void {
    this.currentResultPage.set(page);
  }

  getResultPageNumbers(results: SearchResults | undefined): number[] {
    const total = this.getTotalResultPages(results);
    const current = this.currentResultPage();
    const pages: number[] = [];
    
    let start = Math.max(1, current - 2);
    let end = Math.min(total, current + 2);
    
    if (end - start < 4) {
      if (start === 1) {
        end = Math.min(total, 5);
      } else {
        start = Math.max(1, total - 4);
      }
    }
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    return pages;
  }

  // Modal de imagen
  openImageModal(activo: Activo): void {
    if (activo.imagen_base64) {
      this.selectedImage.set(activo.imagen_base64);
      this.selectedImageName.set(activo.nombre);
      this.showImageModal.set(true);
    }
  }

  closeImageModal(): void {
    this.showImageModal.set(false);
    this.selectedImage.set(null);
    this.selectedImageName.set('');
  }

  toggleViewAll(messageId: number): void {
    this.chatbotService.toggleShowAllResults(messageId);
    this.currentResultPage.set(1);
  }

  // Navegación a activo
  navigateToActivo(activoId: number): void {
    this.router.navigate(['/activos'], { 
      queryParams: { id: activoId },
      queryParamsHandling: 'merge'
    });
    this.closeChat();
  }

  // Formato de precios
  formatCurrency(value: number | undefined): string {
    if (value === undefined) return 'N/A';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0
    }).format(value);
  }

  // Estado con colores
  getEstadoClass(estado: string): string {
    switch (estado) {
      case 'operativo': return 'estado-operativo';
      case 'en_mantenimiento': return 'estado-mantenimiento';
      case 'fuera_de_servicio': return 'estado-fuera';
      case 'en_reparacion': return 'estado-reparacion';
      default: return '';
    }
  }

  getEstadoLabel(estado: string): string {
    switch (estado) {
      case 'operativo': return 'Operativo';
      case 'en_mantenimiento': return 'En Mantenimiento';
      case 'fuera_de_servicio': return 'Fuera de Servicio';
      case 'en_reparacion': return 'En Reparación';
      default: return estado;
    }
  }

  // Auditorías
  getActionBadgeClass(action: string): string {
    switch (action) {
      case 'CREATE': return 'badge-create';
      case 'UPDATE': return 'badge-update';
      case 'DELETE': return 'badge-delete';
      case 'LOGIN': return 'badge-login';
      case 'LOGOUT': return 'badge-logout';
      default: return '';
    }
  }

  formatDate(timestamp: string): string {
    return new Date(timestamp).toLocaleString('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Exportar auditorías
  openExportModal(): void {
    this.exportConfig.set({
      allData: true,
      fechaDesde: '',
      fechaHasta: '',
      categorias: {
        LOGIN: true,
        LOGOUT: true,
        CREATE: true,
        UPDATE: true,
        DELETE: true
      }
    });
    this.showExportModal.set(true);
  }

  closeExportModal(): void {
    this.showExportModal.set(false);
  }

  toggleAllData(): void {
    this.exportConfig.update(c => ({ ...c, allData: !c.allData }));
  }

  toggleCategoria(cat: 'LOGIN' | 'LOGOUT' | 'CREATE' | 'UPDATE' | 'DELETE'): void {
    this.exportConfig.update(c => ({
      ...c,
      categorias: { ...c.categorias, [cat]: !c.categorias[cat] }
    }));
  }

  updateFechaDesde(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.exportConfig.update(c => ({ ...c, fechaDesde: value }));
  }

  updateFechaHasta(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.exportConfig.update(c => ({ ...c, fechaHasta: value }));
  }

  async exportToPDF(): Promise<void> {
    this.isExporting.set(true);
    try {
      const data = await this.getFilteredExportData();
      await this.generatePDF(data);
    } catch (error) {
      console.error('Error exporting to PDF:', error);
    } finally {
      this.isExporting.set(false);
      this.closeExportModal();
    }
  }

  async exportToXML(): Promise<void> {
    this.isExporting.set(true);
    try {
      const data = await this.getFilteredExportData();
      await this.generateXML(data);
    } catch (error) {
      console.error('Error exporting to XML:', error);
    } finally {
      this.isExporting.set(false);
      this.closeExportModal();
    }
  }

  private async getFilteredExportData(): Promise<AuditLog[]> {
    const config = this.exportConfig();
    let data: AuditLog[] = [];
    
    // Si "todos los datos", cargar TODAS las auditorías de la DB
    if (config.allData) {
      data = await this.chatbotService.getAllAuditsForExport();
      
      // Aplicar los filtros de la búsqueda original (usuario, acción)
      const searchFilters = this.chatbotService.getLastSearchFilters();
      if (searchFilters) {
        // Filtrar por usuario
        if (searchFilters.usuario) {
          const usuario = searchFilters.usuario.toLowerCase();
          data = data.filter(a => a.username?.toLowerCase().includes(usuario));
        }
        // Filtrar por acción
        if (searchFilters.accion) {
          data = data.filter(a => a.action === searchFilters.accion);
        }
      }
    } else {
      // Si no, usar solo los resultados del último mensaje del chat
      const lastResults = this.chatbotService.messages().find(m => m.results?.audits)?.results?.audits || [];
      data = [...lastResults];
    }
    
    // Filtrar por fechas si se especificaron
    if (!config.allData) {
      if (config.fechaDesde) {
        const desde = new Date(config.fechaDesde);
        data = data.filter(d => new Date(d.timestamp) >= desde);
      }
      if (config.fechaHasta) {
        const hasta = new Date(config.fechaHasta);
        hasta.setHours(23, 59, 59);
        data = data.filter(d => new Date(d.timestamp) <= hasta);
      }
    }
    
    // Filtrar por categorías seleccionadas
    const selectedCategories = Object.entries(config.categorias)
      .filter(([_, selected]) => selected)
      .map(([cat, _]) => cat);
    
    // Solo filtrar si NO todas las categorías están seleccionadas
    const allCategoriesSelected = selectedCategories.length === 5;
    if (!allCategoriesSelected) {
      data = data.filter(d => selectedCategories.includes(d.action));
    }
    
    return data;
  }

  private async generatePDF(data: AuditLog[]): Promise<void> {
    // Crear contenido HTML para el PDF
    let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Reporte de Auditoría</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th { background-color: #667eea; color: white; padding: 12px; text-align: left; }
          td { padding: 10px; border-bottom: 1px solid #ddd; }
          tr:nth-child(even) { background-color: #f9f9f9; }
          .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
          .badge-create { background-color: #10b981; color: white; }
          .badge-update { background-color: #3b82f6; color: white; }
          .badge-delete { background-color: #ef4444; color: white; }
          .badge-login { background-color: #8b5cf6; color: white; }
          .badge-logout { background-color: #6b7280; color: white; }
          .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>📋 Reporte de Auditoría</h1>
        <p>Fecha de generación: ${new Date().toLocaleString('es-CO')}</p>
        <p>Total de registros: ${data.length}</p>
        <table>
          <thead>
            <tr>
              <th>Fecha/Hora</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Tabla</th>
              <th>Detalles</th>
            </tr>
          </thead>
          <tbody>
    `;

    data.forEach(log => {
      htmlContent += `
        <tr>
          <td>${this.formatDate(log.timestamp)}</td>
          <td>${log.username || 'Usuario #' + log.user_id}</td>
          <td><span class="badge badge-${log.action.toLowerCase()}">${log.action}</span></td>
          <td>${log.table_name}</td>
          <td>${log.new_value || log.old_value || '-'}</td>
        </tr>
      `;
    });

    htmlContent += `
          </tbody>
        </table>
        <div class="footer">
          <p>Gestor de Activos - Sistema de Auditoría</p>
        </div>
      </body>
      </html>
    `;

    // Crear blob y descargar
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `auditoria_${new Date().toISOString().split('T')[0]}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async generateXML(data: AuditLog[]): Promise<void> {
    let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xmlContent += '<AuditReport>\n';
    xmlContent += `  <GeneratedAt>${new Date().toISOString()}</GeneratedAt>\n`;
    xmlContent += `  <TotalRecords>${data.length}</TotalRecords>\n`;
    xmlContent += '  <Records>\n';

    data.forEach(log => {
      xmlContent += '    <Record>\n';
      xmlContent += `      <ID>${log.id}</ID>\n`;
      xmlContent += `      <Timestamp>${log.timestamp}</Timestamp>\n`;
      xmlContent += `      <UserID>${log.user_id}</UserID>\n`;
      xmlContent += `      <Username>${this.escapeXml(log.username || '')}</Username>\n`;
      xmlContent += `      <Action>${log.action}</Action>\n`;
      xmlContent += `      <TableName>${log.table_name}</TableName>\n`;
      xmlContent += `      <RecordID>${log.record_id}</RecordID>\n`;
      if (log.old_value) {
        xmlContent += `      <OldValue>${this.escapeXml(log.old_value)}</OldValue>\n`;
      }
      if (log.new_value) {
        xmlContent += `      <NewValue>${this.escapeXml(log.new_value)}</NewValue>\n`;
      }
      xmlContent += '    </Record>\n';
    });

    xmlContent += '  </Records>\n';
    xmlContent += '</AuditReport>';

    // Crear blob y descargar
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `auditoria_${new Date().toISOString().split('T')[0]}.xml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Quick actions
  quickSearch(query: string): void {
    this.inputMessage = query;
    this.sendMessage();
  }
}
