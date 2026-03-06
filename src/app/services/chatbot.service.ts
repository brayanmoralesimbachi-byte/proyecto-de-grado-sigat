import { Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { Activo, AuditLog, Categoria, Keyword, TauriService } from './tauri.service';

export interface ChatMessage {
  id: number;
  type: 'user' | 'bot';
  content: string;
  timestamp: Date;
  results?: SearchResults;
  showAllResults?: boolean;
}

export interface SearchResults {
  activos?: Activo[];
  audits?: AuditLog[];
  totalCount: number;
  query: ParsedQuery;
  message?: string;
  isPartialMatch?: boolean;
  removedFilters?: string[];
}

export interface ParsedQuery {
  type: 'activos' | 'audits' | 'unknown';
  keywords: string[];
  filters: {
    codigo?: string;
    categoria?: string;
    estado?: string;
    marca?: string;
    pulgadas?: number;
    calibre?: string;        // Para armas: 9mm, .45, 7.62mm, etc.
    litros?: number;         // Para líquidos
    peso?: number;           // Para alimentos: kg, libras, gramos
    unidad_peso?: string;    // kg, lb, g
    medida_generica?: string; // Cualquier otra medida (ej: "3 kg", "500ml", "9mm")
    precio_min?: number;
    precio_max?: number;
    ubicacion?: string;
    nombre?: string;
    descripcion?: string;
    fecha_desde?: string;
    fecha_hasta?: string;
    tiene_imagen?: boolean;
    // Para auditorías
    usuario?: string;
    accion?: string;
  };
  originalText: string;
}

@Injectable({
  providedIn: 'root'
})
export class ChatbotService {
  private messageIdCounter = 0;
  messages = signal<ChatMessage[]>([]);
  isProcessing = signal(false);
  
  private activos: Activo[] = [];
  private audits: AuditLog[] = [];
  private lastSearchResults: SearchResults | null = null;
  
  // Keywords y categorías dinámicas desde la DB
  private keywordsDB: Keyword[] = [];
  private categoriasDB: Categoria[] = [];
  private keywordsLoaded = false;

  // Palabras clave para clasificar el tipo de búsqueda (se cargan dinámicamente)
  private activoKeywords: string[] = [];
  private categoriaMap: { [key: string]: string } = {};
  private estadoMap: { [key: string]: string } = {};
  private marcasComunes: string[] = [];

  // Keywords de auditoría (fijos ya que no cambian)
  private auditKeywords = [
    'auditoria', 'auditoría', 'registro', 'login', 'logout', 'ingreso', 'sesion', 'sesión',
    'ultimo', 'última', 'último', 'cambio', 'modificacion', 'modificación',
    'quien', 'quién', 'cuando', 'cuándo', 'historial', 'actividad'
  ];

  constructor(
    private tauriService: TauriService,
    private authService: AuthService
  ) {
    this.initializeChat();
    this.loadKeywordsFromDB();
  }

  /** Carga las keywords y categorías desde la base de datos */
  private async loadKeywordsFromDB(): Promise<void> {
    try {
      // Cargar keywords y categorías en paralelo
      const [keywords, categorias] = await Promise.all([
        this.tauriService.getKeywords(),
        this.tauriService.getCategorias()
      ]);
      
      this.keywordsDB = keywords;
      this.categoriasDB = categorias;
      
      // Construir mapas dinámicos
      this.buildKeywordMaps();
      this.keywordsLoaded = true;
      
      console.log(`[Chatbot] Cargadas ${keywords.length} keywords y ${categorias.length} categorías`);
    } catch (error) {
      console.error('[Chatbot] Error al cargar keywords:', error);
      // Usar valores por defecto si falla la carga
      this.useDefaultKeywords();
    }
  }

  /** Construye los mapas de keywords desde los datos de la DB */
  private buildKeywordMaps(): void {
    this.activoKeywords = [];
    this.categoriaMap = {};
    this.estadoMap = {};
    this.marcasComunes = [];

    for (const kw of this.keywordsDB) {
      const palabra = kw.palabra.toLowerCase();
      
      switch (kw.tipo) {
        case 'producto':
        case 'atributo':
          this.activoKeywords.push(palabra);
          if (kw.categoria_asociada) {
            this.categoriaMap[palabra] = kw.categoria_asociada;
          }
          break;
          
        case 'marca':
          this.marcasComunes.push(palabra);
          if (kw.categoria_asociada) {
            this.categoriaMap[palabra] = kw.categoria_asociada;
          }
          break;
          
        case 'estado':
          // Mapear estados
          if (palabra.includes('operativo') || palabra.includes('funcionando') || 
              palabra.includes('working') || palabra.includes('operational')) {
            this.estadoMap[palabra] = 'operativo';
          } else if (palabra.includes('mantenimiento') || palabra.includes('maintenance')) {
            this.estadoMap[palabra] = 'en_mantenimiento';
          } else if (palabra.includes('reparacion') || palabra.includes('repair')) {
            this.estadoMap[palabra] = 'en_reparacion';
          } else if (palabra.includes('dañado') || palabra.includes('damaged') || 
                     palabra.includes('fuera') || palabra.includes('vencido') || 
                     palabra.includes('expired')) {
            this.estadoMap[palabra] = 'fuera_de_servicio';
          }
          break;
          
        case 'accion':
          // Las acciones de búsqueda también se agregan a activoKeywords
          this.activoKeywords.push(palabra);
          break;
      }
    }
  }

  /** Usa keywords por defecto si falla la carga desde DB */
  private useDefaultKeywords(): void {
    this.activoKeywords = [
      'computador', 'computadora', 'laptop', 'monitor', 'tv', 'televisor',
      'equipo', 'activo', 'producto', 'mobiliario', 'mueble', 'silla', 'escritorio',
      'herramienta', 'impresora', 'router', 'arma', 'rifle', 'pistola', 'municion',
      'busco', 'necesito', 'quiero', 'muéstrame', 'muestra', 'encuentra'
    ];

    this.categoriaMap = {
      'computador': 'Equipos de Cómputo',
      'computadora': 'Equipos de Cómputo',
      'computadores': 'Equipos de Cómputo',
      'computadoras': 'Equipos de Cómputo',
      'laptop': 'Equipos de Cómputo',
      'portátil': 'Equipos de Cómputo',
      'portátiles': 'Equipos de Cómputo',
      'portatil': 'Equipos de Cómputo',
      'portatiles': 'Equipos de Cómputo',
      'monitor': 'Equipos de Cómputo',
      'monitores': 'Equipos de Cómputo',
      'tv': 'Equipos de Telecomunicaciones',
      'televisor': 'Equipos de Telecomunicaciones',
      'televisores': 'Equipos de Telecomunicaciones',
      'television': 'Equipos de Telecomunicaciones',
      'televisión': 'Equipos de Telecomunicaciones',
      'router': 'Equipos de Telecomunicaciones',
      'routers': 'Equipos de Telecomunicaciones',
      'silla': 'Mobiliario',
      'sillas': 'Mobiliario',
      'escritorio': 'Mobiliario',
      'escritorios': 'Mobiliario',
      'herramienta': 'Herramientas',
      'herramientas': 'Herramientas',
      'arma': 'Armamento',
      'armas': 'Armamento',
      'rifle': 'Armamento',
      'rifles': 'Armamento',
      'pistola': 'Armamento',
      'pistolas': 'Armamento',
      'municion': 'Municiones',
      'munición': 'Municiones',
      'municiones': 'Municiones',
      'bala': 'Municiones',
      'balas': 'Municiones',
      'granada': 'Municiones',
      'granadas': 'Municiones'
    };

    this.estadoMap = {
      'operativo': 'operativo',
      'funcionando': 'operativo',
      'mantenimiento': 'en_mantenimiento',
      'reparacion': 'en_reparacion',
      'dañado': 'fuera_de_servicio'
    };

    this.marcasComunes = [
      'lg', 'samsung', 'sony', 'dell', 'hp', 'lenovo', 'asus', 'acer',
      'apple', 'glock', 'beretta', 'colt', 'sig', 'remington', 'motorola'
    ];
  }

  private initializeChat(): void {
    const welcomeMessage: ChatMessage = {
      id: this.messageIdCounter++,
      type: 'bot',
      content: '¡Hola! 👋 Soy tu asistente de búsqueda. Puedo ayudarte a encontrar activos utilizando lenguaje natural.\n\n**Ejemplos de búsqueda:**\n- "Busco un computador de marca Dell"\n- "Muéstrame televisores LG de 55 pulgadas"\n- "Necesito equipos con precio menor a 500,000"\n- "Mostrar activos en estado operativo"',
      timestamp: new Date()
    };

    if (this.authService.hasRole('admin')) {
      welcomeMessage.content += '\n\n**Como administrador también puedes preguntar:**\n- "¿Cuál fue el último ingreso de usuario?"\n- "Mostrar actividad de login de hoy"';
    }

    this.messages.set([welcomeMessage]);
  }

  async loadData(): Promise<void> {
    try {
      this.activos = await this.tauriService.getActivos();
      if (this.authService.hasRole('admin')) {
        this.audits = await this.tauriService.getAuditLog(500);
      }
    } catch (error) {
      console.error('Error loading data for chatbot:', error);
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!text.trim()) return;

    // Agregar mensaje del usuario
    const userMessage: ChatMessage = {
      id: this.messageIdCounter++,
      type: 'user',
      content: text,
      timestamp: new Date()
    };
    this.messages.update(msgs => [...msgs, userMessage]);

    this.isProcessing.set(true);

    try {
      // Recargar datos frescos
      await this.loadData();

      // Parsear la consulta
      const parsedQuery = this.parseQuery(text);

      // Procesar según el tipo de consulta
      let response: ChatMessage;

      if (this.isAffirmativeResponse(text)) {
        response = this.handleAffirmativeResponse();
      } else if (this.isNegativeResponse(text)) {
        response = this.handleNegativeResponse();
      } else if (this.isViewAllRequest(text)) {
        response = this.handleViewAllRequest();
      } else if (this.isMoreSearchRequest(text)) {
        response = this.handleMoreSearchRequest();
      } else if (parsedQuery.type === 'audits') {
        response = await this.searchAudits(parsedQuery);
      } else {
        response = await this.searchActivos(parsedQuery);
      }

      this.messages.update(msgs => [...msgs, response]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: this.messageIdCounter++,
        type: 'bot',
        content: '❌ Lo siento, ocurrió un error al procesar tu solicitud. Por favor, intenta de nuevo.',
        timestamp: new Date()
      };
      this.messages.update(msgs => [...msgs, errorMessage]);
    } finally {
      this.isProcessing.set(false);
    }
  }

  private parseQuery(text: string): ParsedQuery {
    const lowerText = text.toLowerCase();
    const words = lowerText.split(/\s+/);

    const query: ParsedQuery = {
      type: 'unknown',
      keywords: [],
      filters: {},
      originalText: text
    };

    // Determinar tipo de búsqueda
    const hasActivoKeywords = this.activoKeywords.some(kw => lowerText.includes(kw));
    const hasAuditKeywords = this.auditKeywords.some(kw => lowerText.includes(kw));

    if (hasAuditKeywords && this.authService.hasRole('admin')) {
      query.type = 'audits';
    } else if (hasActivoKeywords || !hasAuditKeywords) {
      query.type = 'activos';
    }

    // Extraer categoría - usar coincidencia de palabra completa
    for (const [keyword, categoria] of Object.entries(this.categoriaMap)) {
      const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'i');
      if (regex.test(lowerText)) {
        // Verificar que no haya negación antes de la palabra
        const negacionRegex = new RegExp(`(no|sin|ning[uú]n[ao]?)\\s+(?:\\w+\\s+){0,2}${this.escapeRegex(keyword)}\\b`, 'i');
        if (!negacionRegex.test(lowerText)) {
          query.filters.categoria = categoria;
          query.keywords.push(keyword);
          break;
        }
      }
    }

    // Extraer estado - usar coincidencia de palabra completa
    for (const [keyword, estado] of Object.entries(this.estadoMap)) {
      const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'i');
      if (regex.test(lowerText)) {
        // Verificar que no haya negación antes de la palabra
        const negacionRegex = new RegExp(`(no|sin|ning[uú]n[ao]?)\\s+(?:\\w+\\s+){0,2}${this.escapeRegex(keyword)}\\b`, 'i');
        if (!negacionRegex.test(lowerText)) {
          query.filters.estado = estado;
          query.keywords.push(keyword);
          break;
        }
      }
    }

    // Extraer marca - usar coincidencia de palabra completa para evitar falsos positivos
    // (ej: "alguno" contiene "lg" pero no es la marca LG)
    for (const marca of this.marcasComunes) {
      const regex = new RegExp(`\\b${this.escapeRegex(marca)}\\b`, 'i');
      if (regex.test(lowerText)) {
        // Verificar que no haya negación antes de la marca
        const negacionRegex = new RegExp(`(no|sin|ning[uú]n[ao]?)\\s+(?:\\w+\\s+){0,2}${this.escapeRegex(marca)}\\b`, 'i');
        if (!negacionRegex.test(lowerText)) {
          query.filters.marca = marca;
          query.keywords.push(marca);
          break;
        }
      }
    }

    // Extraer pulgadas - con contexto para evitar falsos positivos
    const pulgadasMatch = lowerText.match(/(\d+)\s*(pulgadas?|inch)/i);
    if (pulgadasMatch) {
      query.filters.pulgadas = parseInt(pulgadasMatch[1]);
      query.keywords.push(`${pulgadasMatch[1]} pulgadas`);
    } else {
      // Solo detectar comillas (", '') si hay contexto de pantalla/monitor/tv cercano
      const pulgadasComillasMatch = lowerText.match(/(\d+)\s*("| '')/);
      if (pulgadasComillasMatch) {
        const contextoRelevante = /pantalla|monitor|televisor|tv|display|screen|pulgada/i.test(lowerText);
        if (contextoRelevante) {
          query.filters.pulgadas = parseInt(pulgadasComillasMatch[1]);
          query.keywords.push(`${pulgadasComillasMatch[1]} pulgadas`);
        }
      }
    }

    // Extraer calibre (para armas)
    const calibrePatterns = [
      /(\d+(?:\.\d+)?)\s*mm\b/i,                    // 9mm, 7.62mm
      /\.(\d+)\b/,                                   // .45, .357, .22
      /calibre\s*[:]?\s*([\d.]+\s*(?:mm)?)/i       // calibre: 9mm, calibre .45
    ];
    for (const pattern of calibrePatterns) {
      const calibreMatch = text.match(pattern);
      if (calibreMatch) {
        query.filters.calibre = calibreMatch[0].trim();
        query.keywords.push(`calibre ${calibreMatch[0]}`);
        break;
      }
    }

    // Extraer litros/mililitros (para líquidos)
    const litrosMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(litros?|lts?|ml|mililitros?)/i);
    if (litrosMatch) {
      let litros = parseFloat(litrosMatch[1]);
      if (litrosMatch[2].match(/ml|mililitros?/i)) {
        litros = litros / 1000; // Convertir ml a litros
      }
      query.filters.litros = litros;
      query.keywords.push(`${litrosMatch[1]} ${litrosMatch[2]}`);
    }

    // Extraer peso (para alimentos, materiales)
    // IMPORTANTE: Procesar en orden específico - kg ANTES que g
    let pesoEncontrado = false;
    
    // Primero intentar kilogramos
    const kgMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(kilogramos?|kgs?|kg)\b/i);
    if (kgMatch) {
      query.filters.peso = parseFloat(kgMatch[1]);
      query.filters.unidad_peso = 'kg';
      query.keywords.push(`${kgMatch[1]} kg`);
      pesoEncontrado = true;
    }
    
    // Si no hay kg, intentar libras
    if (!pesoEncontrado) {
      const lbMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(libras?|lbs?)\b/i);
      if (lbMatch) {
        query.filters.peso = parseFloat(lbMatch[1]);
        query.filters.unidad_peso = 'lb';
        query.keywords.push(`${lbMatch[1]} lb`);
        pesoEncontrado = true;
      }
    }
    
    // Si no hay kg ni lb, intentar gramos
    if (!pesoEncontrado) {
      const gMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(gramos?|grs?)\b/i);
      if (gMatch) {
        query.filters.peso = parseFloat(gMatch[1]);
        query.filters.unidad_peso = 'g';
        query.keywords.push(`${gMatch[1]} g`);
        pesoEncontrado = true;
      }
    }
    
    // Solo buscar "g" standalone si no se encontró ningún otro peso
    if (!pesoEncontrado) {
      // Buscar "Xg" pero asegurarse que NO sea parte de "kg"
      const gStandaloneMatch = lowerText.match(/\b(\d+(?:\.\d+)?)\s*g\b/i);
      if (gStandaloneMatch) {
        // Verificar que no esté precedido por 'k'
        const fullMatch = gStandaloneMatch[0];
        const index = lowerText.indexOf(fullMatch);
        if (index > 0 && lowerText[index - 1] === 'k') {
          // Es "kg", no capturar
        } else {
          query.filters.peso = parseFloat(gStandaloneMatch[1]);
          query.filters.unidad_peso = 'g';
          query.keywords.push(`${gStandaloneMatch[1]} g`);
        }
      }
    }

    // Extraer rango de precio
    const precioMatch = lowerText.match(/(?:precio|valor|menor|menos|mayor|más|hasta|desde|cueste|cuesta|valga)\s*(?:de|a|que)?\s*\$?\s*([\d,.]+)/gi);
    if (precioMatch) {
      precioMatch.forEach(match => {
        const numMatch = match.match(/([\d,.]+)/);
        if (numMatch) {
          const valor = parseFloat(numMatch[1].replace(/,/g, ''));
          // Detectar si es precio máximo o mínimo
          if (lowerText.includes('menor') || lowerText.includes('menos') || lowerText.includes('hasta') || lowerText.includes('máximo') || lowerText.includes('cueste menos') || lowerText.includes('cuesta menos')) {
            query.filters.precio_max = valor;
          } else if (lowerText.includes('mayor') || lowerText.includes('más') || lowerText.includes('desde') || lowerText.includes('mínimo') || lowerText.includes('cueste más') || lowerText.includes('cuesta más')) {
            query.filters.precio_min = valor;
          }
        }
      });
    }

    // Extraer código de activo - ALTA PRIORIDAD
    const codigoPatterns = [
      /(?:codigo|código|code|activo|producto)\s*[:]?\s*([a-z0-9\-_]+)/i,  // "código: ABC123" o "activo: 12345"
      /\b([0-9]{10,})\b/,  // Códigos numéricos muy largos (10+ dígitos) para evitar fechas YYYYMMDD
      /\b([A-Z]{2,}[0-9]{3,})\b/i,  // Patrones tipo ABC123, DEF456
      /\b([0-9]{3,}[A-Z]{2,}[0-9]{2,})\b/i  // Patrones tipo 123AB45
    ];
    
    for (const pattern of codigoPatterns) {
      const codigoMatch = text.match(pattern);
      if (codigoMatch) {
        query.filters.codigo = codigoMatch[1];
        query.keywords.push(`código: ${codigoMatch[1]}`);
        break;
      }
    }

    // Extraer ubicación - mejorado para capturar variantes como "en facatativa"
    const ubicacionPatterns = [
      /(?:en|ubicación|ubicacion|lugar|zona)\s+([a-záéíóúñü]+)(?:\s|$|\.|\?)/i,
      /(?:ubicado|ubicada|localizado|localizada)\s+(?:en\s+)?([a-záéíóúñü]+)/i
    ];
    
    for (const pattern of ubicacionPatterns) {
      const ubicacionMatch = lowerText.match(pattern);
      if (ubicacionMatch) {
        const ubicacion = ubicacionMatch[1].trim();
        // Ignorar palabras comunes que no son ubicaciones reales
        const palabrasIgnorar = [
          'un', 'una', 'el', 'la', 'los', 'las', 
          'alguno', 'alguna', 'estado', 'mantenimiento', 'operativo',
          'general', 'realidad', 'total', 'breve', 'resumen', 'particular',
          'concreto', 'específico', 'detalle', 'caso', 'momento', 'orden',
          'bueno', 'malo', 'mejor', 'peor', 'común', 'raro'
        ];
        if (!palabrasIgnorar.includes(ubicacion)) {
          query.filters.ubicacion = ubicacion;
          query.keywords.push(ubicacion);
          break;
        }
      }
    }

    // Filtro de imagen
    if (lowerText.includes('con imagen') || lowerText.includes('que tenga imagen')) {
      query.filters.tiene_imagen = true;
    } else if (lowerText.includes('sin imagen')) {
      query.filters.tiene_imagen = false;
    }

    // Para auditorías: extraer acción
    if (query.type === 'audits') {
      if (lowerText.includes('login') || lowerText.includes('ingreso')) {
        query.filters.accion = 'LOGIN';
      } else if (lowerText.includes('logout') || lowerText.includes('salida') || lowerText.includes('cerró sesión')) {
        query.filters.accion = 'LOGOUT';
      } else if (lowerText.includes('creó') || lowerText.includes('crear') || lowerText.includes('nuevo')) {
        query.filters.accion = 'CREATE';
      } else if (lowerText.includes('modificó') || lowerText.includes('cambió') || lowerText.includes('actualizó')) {
        query.filters.accion = 'UPDATE';
      } else if (lowerText.includes('eliminó') || lowerText.includes('borró')) {
        query.filters.accion = 'DELETE';
      }

      // Extraer usuario
      const usuarioMatch = lowerText.match(/(?:usuario|user)\s+["']?(\w+)["']?/i);
      if (usuarioMatch) {
        query.filters.usuario = usuarioMatch[1];
      }
    }

    return query;
  }

  private async searchActivos(query: ParsedQuery): Promise<ChatMessage> {
    let results = [...this.activos];
    let appliedFilters: string[] = [];
    let removedFilters: string[] = [];
    let codigoNoEncontrado = false;
    let codigoBuscado = '';

    // PRIORIDAD ALTA: Búsqueda por código exacto
    if (query.filters.codigo) {
      codigoBuscado = query.filters.codigo;
      const codigoExacto = results.find(a => 
        a.codigo.toLowerCase() === codigoBuscado.toLowerCase()
      );
      
      if (codigoExacto) {
        // Código encontrado - retornar solo ese activo
        results = [codigoExacto];
        appliedFilters.push(`código: ${codigoBuscado}`);
      } else {
        // Código NO encontrado - marcar para mensaje especial
        codigoNoEncontrado = true;
        removedFilters.push(`código: ${codigoBuscado} (no existe)`);
        // Continuar búsqueda con otros criterios para ofrecer alternativas
      }
    }

    // Aplicar filtros
    if (query.filters.categoria) {
      const filtered = results.filter(a => a.categoria === query.filters.categoria);
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`categoría: ${query.filters.categoria}`);
      } else {
        removedFilters.push(`categoría: ${query.filters.categoria}`);
      }
    }

    if (query.filters.estado) {
      const filtered = results.filter(a => a.estado === query.filters.estado);
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`estado: ${query.filters.estado}`);
      } else {
        removedFilters.push(`estado: ${query.filters.estado}`);
      }
    }

    if (query.filters.marca) {
      const marca = query.filters.marca.toLowerCase();
      const filtered = results.filter(a => 
        a.nombre.toLowerCase().includes(marca) ||
        a.descripcion?.toLowerCase().includes(marca)
      );
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`marca: ${query.filters.marca.toUpperCase()}`);
      } else {
        removedFilters.push(`marca: ${query.filters.marca.toUpperCase()}`);
      }
    }

    if (query.filters.pulgadas) {
      const pulgadas = query.filters.pulgadas.toString();
      const filtered = results.filter(a => 
        a.nombre.toLowerCase().includes(pulgadas) ||
        a.descripcion?.toLowerCase().includes(pulgadas) ||
        a.descripcion?.toLowerCase().includes(`${pulgadas}"`) ||
        a.descripcion?.toLowerCase().includes(`${pulgadas} pulgadas`)
      );
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`pulgadas: ${pulgadas}"`);
      } else {
        removedFilters.push(`pulgadas: ${pulgadas}"`);
      }
    }

    // Filtro de calibre (para armas)
    if (query.filters.calibre) {
      const calibre = query.filters.calibre.toLowerCase();
      const filtered = results.filter(a => 
        a.nombre.toLowerCase().includes(calibre) ||
        a.descripcion?.toLowerCase().includes(calibre) ||
        a.palabras_clave?.toLowerCase().includes(calibre)
      );
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`calibre: ${query.filters.calibre}`);
      } else {
        removedFilters.push(`calibre: ${query.filters.calibre}`);
      }
    }

    // Filtro de litros (para líquidos)
    if (query.filters.litros) {
      const litros = query.filters.litros;
      const filtered = results.filter(a => {
        const desc = (a.nombre + ' ' + (a.descripcion || '')).toLowerCase();
        // Buscar el valor exacto o aproximado (±10%)
        const rango = litros * 0.1;
        const match = desc.match(/(\d+(?:\.\d+)?)\s*(?:litros?|lts?|ml)/i);
        if (match) {
          let valorActivo = parseFloat(match[1]);
          if (match[0].match(/ml/i)) valorActivo = valorActivo / 1000;
          return Math.abs(valorActivo - litros) <= rango;
        }
        return false;
      });
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`${query.filters.litros} litros`);
      } else {
        removedFilters.push(`${query.filters.litros} litros`);
      }
    }

    // Filtro de peso (para alimentos, materiales)
    if (query.filters.peso && query.filters.unidad_peso) {
      const peso = query.filters.peso;
      const unidad = query.filters.unidad_peso;
      const filtered = results.filter(a => {
        const desc = (a.nombre + ' ' + (a.descripcion || '')).toLowerCase();
        // Buscar la unidad específica
        let pattern: RegExp;
        if (unidad === 'kg') {
          pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:kg|kilogramos?)`, 'i');
        } else if (unidad === 'lb') {
          pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:lb|libras?)`, 'i');
        } else {
          pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:g|gramos?)`, 'i');
        }
        
        const match = desc.match(pattern);
        if (match) {
          const valorActivo = parseFloat(match[1]);
          const rango = peso * 0.15; // ±15% de tolerancia
          return Math.abs(valorActivo - peso) <= rango;
        }
        return false;
      });
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`${peso} ${unidad}`);
      } else {
        removedFilters.push(`${peso} ${unidad}`);
      }
    }

    // Si no se encontraron filtros de medida específicos, buscar cualquier mención de la medida en el texto
    if (!query.filters.pulgadas && !query.filters.calibre && !query.filters.litros && !query.filters.peso) {
      const medidaGenericaMatch = query.originalText.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/i);
      if (medidaGenericaMatch && medidaGenericaMatch[2].length <= 4) {
        // Solo considerar unidades cortas (mm, kg, lb, etc.)
        const medidaCompleta = medidaGenericaMatch[0];
        const filtered = results.filter(a => {
          const desc = (a.nombre + ' ' + (a.descripcion || '') + ' ' + (a.palabras_clave || '')).toLowerCase();
          return desc.includes(medidaCompleta.toLowerCase());
        });
        if (filtered.length > 0 && filtered.length < results.length) {
          results = filtered;
          appliedFilters.push(`medida: ${medidaCompleta}`);
        }
      }
    }

    if (query.filters.precio_max !== undefined) {
      const filtered = results.filter(a => 
        (a.valor_adquisicion || 0) <= query.filters.precio_max!
      );
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`precio máximo: $${query.filters.precio_max.toLocaleString()}`);
      } else {
        removedFilters.push(`precio máximo: $${query.filters.precio_max.toLocaleString()}`);
      }
    }

    if (query.filters.precio_min !== undefined) {
      const filtered = results.filter(a => 
        (a.valor_adquisicion || 0) >= query.filters.precio_min!
      );
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`precio mínimo: $${query.filters.precio_min.toLocaleString()}`);
      } else {
        removedFilters.push(`precio mínimo: $${query.filters.precio_min.toLocaleString()}`);
      }
    }

    if (query.filters.ubicacion) {
      const ubicacion = query.filters.ubicacion.toLowerCase();
      const filtered = results.filter(a => 
        a.ubicacion?.toLowerCase().includes(ubicacion)
      );
      results = filtered;
      if (filtered.length > 0) {
        appliedFilters.push(`ubicación: ${query.filters.ubicacion}`);
      } else {
        removedFilters.push(`ubicación: ${query.filters.ubicacion}`);
      }
    }

    if (query.filters.tiene_imagen !== undefined) {
      const filtered = results.filter(a => 
        query.filters.tiene_imagen ? !!a.imagen_base64 : !a.imagen_base64
      );
      results = filtered;
      appliedFilters.push(query.filters.tiene_imagen ? 'con imagen' : 'sin imagen');
    }

    // Búsqueda general por palabras clave en el texto
    // IMPORTANTE: Si el usuario buscó por código específico y no se encontró,
    // NO hacer búsqueda adicional por nombre/descripción para evitar confusiones
    if (!codigoNoEncontrado) {
      // Extraer palabras significativas (>3 chars, no stopwords, no demasiado cortas)
      const stopWords = ['busco', 'quiero', 'necesito', 'muéstrame', 'muestra', 'encuentra', 
                         'encontrar', 'ver', 'todos', 'toda', 'todas', 'una', 'uno', 'que', 
                         'con', 'para', 'los', 'las', 'del', 'por', 'hay', 'hola', 'tienes',
                         'tiene', 'alguno', 'alguna', 'algunos', 'algunas', 'como', 'este',
                         'esta', 'esto', 'ese', 'esa', 'eso', 'codigo', 'código', 'toro', 'pero',
                         'favor', 'gracias', 'bien', 'mal', 'mas', 'más', 'dame', 'dime'];
      
      const searchWords = query.originalText.toLowerCase().split(/\s+/).filter(w => {
        const cleanWord = w.replace(/[.,?!¿¡]/g, '');
        // Mínimo 4 caracteres para evitar matches vagos, excepto para códigos/marcas conocidas
        return cleanWord.length >= 4 && !stopWords.includes(cleanWord) && !/^\d+$/.test(cleanWord);
      }).map(w => w.replace(/[.,?!¿¡]/g, ''));

      // Si NO hay palabras significativas Y NO hay filtros aplicados, la búsqueda es demasiado vaga
      const hasFilters = Object.keys(query.filters).length > 0 || appliedFilters.length > 0;
      
      if (searchWords.length === 0 && !hasFilters && results.length === this.activos.length) {
        // Búsqueda demasiado vaga - no hay criterios específicos
        return {
          id: this.messageIdCounter++,
          type: 'bot',
          content: '🤔 No encontré criterios específicos en tu búsqueda. Por favor, intenta con:\n\n' +
                   '• **Categoría**: computador, monitor, silla, etc.\n' +
                   '• **Marca**: Samsung, LG, Dell, HP, etc.\n' +
                   '• **Código**: el número o código del activo\n' +
                   '• **Ubicación**: por ejemplo "en Bogotá"\n' +
                   '• **Estado**: operativo, mantenimiento, etc.\n\n' +
                   'También puedes decir "ver todos los activos" para explorar el inventario completo.',
          timestamp: new Date()
        };
      }

      // Intentar filtrar por nombre/descripción si hay palabras de búsqueda
      if (searchWords.length > 0) {
        const keywordFiltered = results.filter(a => 
          searchWords.some(word => 
            a.nombre.toLowerCase().includes(word) ||
            a.descripcion?.toLowerCase().includes(word) ||
            a.codigo.toLowerCase().includes(word) ||
            a.palabras_clave?.toLowerCase().includes(word)
          )
        );
        // Solo aplicar si encontramos algo, sino mantener resultados previos
        if (keywordFiltered.length > 0) {
          results = keywordFiltered;
        }
      }
    }

    // Búsqueda adicional por sinónimos desde la DB de keywords
    // No buscar sinónimos si estamos buscando por código específico
    if (!codigoNoEncontrado && results.length === 0 && this.keywordsDB.length > 0) {
      const synonymResults = this.searchBySynonyms(query.originalText);
      if (synonymResults.length > 0) {
        results = synonymResults;
      }
    }

    // Generar respuesta
    const searchResults: SearchResults = {
      activos: results,
      totalCount: results.length,
      query: query,
      isPartialMatch: removedFilters.length > 0,
      removedFilters: removedFilters
    };

    this.lastSearchResults = searchResults;

    return this.generateActivosResponse(searchResults, appliedFilters, codigoNoEncontrado, codigoBuscado);
  }

  private generateActivosResponse(
    results: SearchResults, 
    appliedFilters: string[], 
    codigoNoEncontrado: boolean = false, 
    codigoBuscado: string = ''
  ): ChatMessage {
    let content = '';
    const count = results.totalCount;

    // Mensaje especial si buscaba un código que no existe
    if (codigoNoEncontrado) {
      if (count === 0) {
        content = `❌ **No tenemos el código "${codigoBuscado}"** en nuestro inventario.\n\n`;
        content += '😔 No encontré productos similares que pueda recomendarte en este momento.\n\n';
        content += '**Sugerencias:**\n';
        content += '- Verifica que el código esté escrito correctamente\n';
        content += '- Intenta buscar por nombre del producto (ej: "busco un rifle")\n';
        content += '- Busca por categoría (ej: "muéstrame armamento" o "necesito municiones")\n';
        content += '- Pregunta por características (ej: "pistolas glock" o "chalecos antibalas")';
      } else {
        content = `⚠️ **No tenemos el código "${codigoBuscado}"** en nuestro inventario.\n\n`;
        content += `💡 Pero puedo recomendarte ${count === 1 ? 'este producto' : `estos ${count} productos`} que podrían ser de tu interés:\n\n`;
        if (appliedFilters.length > 0) {
          content += `_Basado en: ${appliedFilters.join(', ')}_\n\n`;
        }
      }
    } else if (count === 0) {
      content = '😔 No encontré ningún activo con esos criterios de búsqueda.\n\n';
      content += '**Sugerencias:**\n';
      content += '- Intenta con términos más generales\n';
      content += '- Revisa si escribiste correctamente la marca o categoría\n';
      content += '- Prueba buscar solo por una característica\n\n';
      content += '¿Te gustaría buscar algo diferente?';
    } else if (results.isPartialMatch && results.removedFilters && results.removedFilters.length > 0) {
      content = `⚠️ No encontré exactamente lo que buscabas, pero encontré **${count} producto${count > 1 ? 's' : ''} similar${count > 1 ? 'es' : ''}**.\n\n`;
      content += `No pude aplicar los filtros: ${results.removedFilters.join(', ')}\n\n`;
      if (appliedFilters.length > 0) {
        content += `Filtros aplicados: ${appliedFilters.join(', ')}\n\n`;
      }
      content += count > 5 ? `Mostrando los primeros 5 resultados:` : `Aquí están los resultados:`;
    } else {
      if (count === 1) {
        content = `✅ ¡Encontré **1 activo** que coincide con tu búsqueda!`;
      } else if (count <= 5) {
        content = `✅ Encontré **${count} activos** que coinciden con tu búsqueda.`;
      } else {
        content = `✅ Encontré **${count} activos** que coinciden con tu búsqueda.\n\nMostrando los primeros 5:`;
      }
      if (appliedFilters.length > 0) {
        content += `\n\n_Filtros aplicados: ${appliedFilters.join(', ')}_`;
      }
    }

    const message: ChatMessage = {
      id: this.messageIdCounter++,
      type: 'bot',
      content: content,
      timestamp: new Date(),
      results: results,
      showAllResults: false
    };

    // Agregar pregunta de seguimiento si hay resultados
    if (count > 0) {
      message.content += '\n\n---\n¿Encontraste lo que buscabas? ¿Deseas **buscar más a profundidad** o **buscar otro producto**?';
    }

    return message;
  }

  private async searchAudits(query: ParsedQuery): Promise<ChatMessage> {
    if (!this.authService.hasRole('admin')) {
      return {
        id: this.messageIdCounter++,
        type: 'bot',
        content: '🔒 Lo siento, solo los administradores pueden consultar registros de auditoría.',
        timestamp: new Date()
      };
    }

    let results = [...this.audits];
    let appliedFilters: string[] = [];

    // Filtrar por acción
    if (query.filters.accion) {
      results = results.filter(a => a.action === query.filters.accion);
      appliedFilters.push(`acción: ${query.filters.accion}`);
    }

    // Filtrar por usuario
    if (query.filters.usuario) {
      const usuario = query.filters.usuario.toLowerCase();
      results = results.filter(a => 
        a.username?.toLowerCase().includes(usuario)
      );
      appliedFilters.push(`usuario: ${query.filters.usuario}`);
    }

    // Buscar "último" o "más reciente"
    const lowerText = query.originalText.toLowerCase();
    if (lowerText.includes('último') || lowerText.includes('ultima') || lowerText.includes('más reciente') || lowerText.includes('reciente')) {
      results = results.slice(0, 1);
    }

    const searchResults: SearchResults = {
      audits: results.slice(0, 10),
      totalCount: results.length,
      query: query
    };

    this.lastSearchResults = searchResults;

    return this.generateAuditsResponse(searchResults, appliedFilters);
  }

  private generateAuditsResponse(results: SearchResults, appliedFilters: string[]): ChatMessage {
    let content = '';
    const count = results.totalCount;

    if (count === 0) {
      content = '📋 No encontré registros de auditoría con esos criterios.\n\n';
      content += '¿Te gustaría buscar otro tipo de actividad?';
    } else {
      if (count === 1) {
        content = `📋 Encontré **1 registro** de auditoría:`;
      } else {
        content = `📋 Encontré **${count} registros** de auditoría.`;
        if (count > 10) {
          content += `\n\nMostrando los primeros 10:`;
        }
      }
      if (appliedFilters.length > 0) {
        content += `\n_Filtros aplicados: ${appliedFilters.join(', ')}_`;
      }
    }

    const message: ChatMessage = {
      id: this.messageIdCounter++,
      type: 'bot',
      content: content,
      timestamp: new Date(),
      results: results,
      showAllResults: false
    };

    if (count > 0) {
      message.content += '\n\n---\n¿Deseas **exportar estos registros** o **buscar más información**?';
    }

    return message;
  }

  private isAffirmativeResponse(text: string): boolean {
    const lower = text.toLowerCase().trim();
    // Solo respuestas afirmativas cortas y claras
    const affirmativePatterns = [
      /^s[ií]$/,
      /^s[ií]\s*,?\s*(gracias|perfecto|excelente|ok)/,
      /^(encontr[eé]|perfecto|gracias|ok|excelente|est[aá]\s+bien)$/,
      /^(muy\s+bien|todo\s+bien|correcto)$/
    ];
    return affirmativePatterns.some(pattern => pattern.test(lower));
  }

  private isNegativeResponse(text: string): boolean {
    const lower = text.toLowerCase().trim();
    // Solo respuestas negativas cortas, no frases largas con "no"
    const negativePatterns = [
      /^no$/,
      /^nada$/,
      /^ning[uú]n[oa]?$/,
      /^no\s*,?\s*(nada|ning[uú]n[oa]?|gracias)/,
      /^no\s+encontr[eé]$/,
      /^ese\s+no\s+(es|era)$/
    ];
    return negativePatterns.some(pattern => pattern.test(lower));
  }

  private isViewAllRequest(text: string): boolean {
    const lower = text.toLowerCase();
    return ['ver todos', 'ver más', 'ver mas', 'mostrar todos', 'mostrar más', 'mostrar mas', 'ver lista completa', 'ver todo', 'lista completa'].some(w => lower.includes(w));
  }

  private isMoreSearchRequest(text: string): boolean {
    const lower = text.toLowerCase();
    const hasMoreKeywords = ['buscar más', 'buscar mas', 'más profundidad', 'mas profundidad', 'buscar otro', 'otro producto', 'nueva búsqueda'].some(w => lower.includes(w));
    
    // Solo tratar como "más búsqueda" si NO tiene criterios específicos
    if (!hasMoreKeywords) return false;
    
    const hasSpecificCriteria = this.hasSpecificSearchCriteria(text);
    return !hasSpecificCriteria;
  }

  /** Detecta si el texto contiene criterios específicos de búsqueda */
  private hasSpecificSearchCriteria(text: string): boolean {
    const lower = text.toLowerCase();
    
    // Detectar código (números largos o patrones)
    if (/\b[0-9]{6,}\b/.test(text)) return true;
    if (/codigo|código|code/.test(lower)) return true;
    
    // Detectar marca específica
    if (this.marcasComunes.some(marca => new RegExp(`\\b${this.escapeRegex(marca)}\\b`, 'i').test(lower))) return true;
    
    // Detectar categoría específica
    if (Object.keys(this.categoriaMap).some(cat => new RegExp(`\\b${this.escapeRegex(cat)}\\b`, 'i').test(lower))) return true;
    
    // Detectar precio
    if (/precio|valor|\$|menor|mayor|hasta|desde/.test(lower) && /[0-9]/.test(text)) return true;
    
    // Detectar pulgadas
    if (/[0-9]+\s*(pulgadas|inch|")/.test(lower)) return true;
    
    // Detectar ubicación específica
    if (/(?:en|ubicación|ubicacion)\s+[a-záéíóúñü]+/.test(lower)) return true;
    
    // Detectar nombre específico de producto (no stopwords)
    const words = lower.split(/\s+/).filter(w => w.length > 3);
    const meaningfulWords = words.filter(w => 
      !['buscar', 'busco', 'quiero', 'necesito', 'muestra', 'ver', 'todos', 'profundidad', 'mas', 'más', 'otro', 'nueva', 'búsqueda', 'producto', 'que', 'tenga', 'con', 'para'].includes(w)
    );
    
    return meaningfulWords.length > 0;
  }

  private handleAffirmativeResponse(): ChatMessage {
    return {
      id: this.messageIdCounter++,
      type: 'bot',
      content: '¡Excelente! 🎉 Me alegra haber podido ayudarte. Si necesitas buscar algo más, no dudes en preguntarme.',
      timestamp: new Date()
    };
  }

  private handleNegativeResponse(): ChatMessage {
    return {
      id: this.messageIdCounter++,
      type: 'bot',
      content: '😔 Lamento no haber encontrado lo que buscabas.\n\n¿Te gustaría:\n- **Buscar más a profundidad** con otros criterios?\n- **Buscar otro producto** diferente?\n- **Ver todos** los resultados disponibles?',
      timestamp: new Date()
    };
  }

  private handleViewAllRequest(): ChatMessage {
    if (this.lastSearchResults && this.lastSearchResults.activos) {
      const results: SearchResults = {
        ...this.lastSearchResults,
        activos: this.lastSearchResults.activos
      };

      return {
        id: this.messageIdCounter++,
        type: 'bot',
        content: `📦 Aquí tienes la lista completa de **${results.totalCount} activos**:`,
        timestamp: new Date(),
        results: results,
        showAllResults: true
      };
    }

    return {
      id: this.messageIdCounter++,
      type: 'bot',
      content: 'No tengo una búsqueda previa. Por favor, dime qué estás buscando.',
      timestamp: new Date()
    };
  }

  private handleMoreSearchRequest(): ChatMessage {
    return {
      id: this.messageIdCounter++,
      type: 'bot',
      content: '¡Claro! Cuéntame más sobre lo que estás buscando. Puedes especificar:\n\n- **Marca** (ej: LG, Samsung, Dell)\n- **Categoría** (ej: computadores, televisores, mobiliario)\n- **Estado** (ej: operativo, en mantenimiento)\n- **Precio** (ej: menor a $500,000)\n- **Ubicación** (ej: en bodega, en oficina principal)',
      timestamp: new Date()
    };
  }

  clearChat(): void {
    this.lastSearchResults = null;
    this.initializeChat();
  }

  /** Obtener todas las auditorías disponibles para exportación */
  async getAllAuditsForExport(): Promise<AuditLog[]> {
    if (!this.authService.hasRole('admin')) {
      return [];
    }
    // Obtener TODAS las auditorías sin límite para exportación
    return await this.tauriService.getAuditLog();
  }

  /** Obtener los filtros aplicados en la última búsqueda */
  getLastSearchFilters(): ParsedQuery['filters'] | null {
    return this.lastSearchResults?.query?.filters || null;
  }

  toggleShowAllResults(messageId: number): void {
    this.messages.update(msgs => 
      msgs.map(msg => 
        msg.id === messageId 
          ? { ...msg, showAllResults: !msg.showAllResults }
          : msg
      )
    );
  }

  /** Busca activos usando sinónimos de la DB de keywords */
  private searchBySynonyms(searchText: string): Activo[] {
    const lowerText = searchText.toLowerCase();
    const words = lowerText.split(/\s+/);
    const results: Activo[] = [];
    const matchedActivos = new Set<number>();

    for (const word of words) {
      if (word.length < 2) continue;

      // Buscar keywords que coincidan
      const matchedKeywords = this.keywordsDB.filter(kw => 
        kw.palabra.toLowerCase().includes(word) ||
        kw.palabra_normalizada?.toLowerCase().includes(word)
      );

      for (const kw of matchedKeywords) {
        // Obtener palabra principal (si es sinónimo, buscar también la principal)
        const searchTerms = [kw.palabra.toLowerCase()];
        if (kw.es_sinonimo_de) {
          searchTerms.push(kw.es_sinonimo_de.toLowerCase());
        }
        
        // También buscar otros sinónimos de la misma familia
        const relatedKeywords = this.keywordsDB.filter(k => 
          k.es_sinonimo_de === kw.palabra ||
          k.es_sinonimo_de === kw.es_sinonimo_de
        );
        for (const related of relatedKeywords) {
          searchTerms.push(related.palabra.toLowerCase());
        }

        // Buscar en activos
        for (const activo of this.activos) {
          if (matchedActivos.has(activo.id!)) continue;

          const actMatchesKeyword = searchTerms.some(term =>
            activo.nombre.toLowerCase().includes(term) ||
            activo.descripcion?.toLowerCase().includes(term) ||
            activo.palabras_clave?.toLowerCase().includes(term) ||
            activo.categoria.toLowerCase().includes(term)
          );

          // También verificar por categoría asociada del keyword
          const actMatchesCategory = kw.categoria_asociada && 
            activo.categoria === kw.categoria_asociada;

          if (actMatchesKeyword || actMatchesCategory) {
            matchedActivos.add(activo.id!);
            results.push(activo);
          }
        }
      }
    }

    return results;
  }

  /** Fuerza la recarga de keywords desde la DB */
  async reloadKeywords(): Promise<void> {
    await this.loadKeywordsFromDB();
  }

  /** Escapa caracteres especiales de regex */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
