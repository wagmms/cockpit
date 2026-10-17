/**
 * ============================================================================
 * ROTINA (GEMINI 4 ARGON) - ESTAÇÃO SOAP (CLIENT-SIDE MODULE)
 * File: gh_cockpit_deploy/estacao_soap.js
 * Architecture: Vanilla ES6+, Resilient LocalStorage + IndexedDB, Web Speech API
 * ============================================================================
 */

// --- 1. VARIÁVEIS DE ESTADO GLOBAL DO MÓDULO ---
let soapDraft = {
  idade: '',
  sexo: '',
  gestante: false,
  alergias: '',
  pas: '',
  pad: '',
  fc: '',
  fr: '',
  spo2: '',
  tax: '',
  peso: '',
  altura: '',
  brain_dump: ''
};

let lastSoapResult = null;
let soapSpeechRecognition = null;
let isRecordingSoap = false;
let textBeforeSpeech = '';
let debounceTimerSoap = null;

const SOAP_DRAFT_KEY = 'rotina_soap_draft';
const IDB_NAME = 'RotinaClinicalDB';
const IDB_VERSION = 1;
const MAX_HISTORY_ITEMS = 50;

/**
 * Retorna a URL base do backend de forma dinâmica e resiliente (compatível com GitHub Pages, Render e Localhost).
 */
function getSoapApiBase() {
  if (typeof window !== 'undefined') {
    if (window.ULTRA_CONFIG && typeof window.ULTRA_CONFIG.API_BASE === 'string') {
      return window.ULTRA_CONFIG.API_BASE;
    }
    if (typeof window.BACKEND_URL === 'string') {
      return window.BACKEND_URL;
    }
  }
  return '';
}

// --- 2. INICIALIZAÇÃO E EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
  initSoapIndexedDB();
  restaurarRascunhoSoap();
  configurarListenersEstacaoSoap();
  calcularMetricasReativas();
});

function configurarListenersEstacaoSoap() {
  const fieldMap = {
    'soap-idade': 'idade',
    'soap-sexo': 'sexo',
    'soap-gestante': 'gestante',
    'soap-alergias': 'alergias',
    'soap-pas': 'pas',
    'soap-pad': 'pad',
    'soap-fc': 'fc',
    'soap-fr': 'fr',
    'soap-spo2': 'spo2',
    'soap-tax': 'tax',
    'soap-peso': 'peso',
    'soap-altura': 'altura',
    'soap-brain-dump': 'brain_dump'
  };

  Object.keys(fieldMap).forEach((domId) => {
    const el = document.getElementById(domId);
    if (!el) return;

    const stateKey = fieldMap[domId];
    const eventType = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';

    el.addEventListener(eventType, (e) => {
      soapDraft[stateKey] = el.type === 'checkbox' ? el.checked : e.target.value;
      
      if (['pas', 'pad', 'peso', 'altura'].includes(stateKey)) {
        calcularMetricasReativas();
      }
      
      agendarAutoSaveSoap();
    });
  });

  // Atalho Ctrl + Enter no Textarea
  const brainDumpEl = document.getElementById('soap-brain-dump');
  if (brainDumpEl) {
    brainDumpEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        enviarParaEstacaoSoap();
      }
    });
  }

  // Fechar modal com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-estacao-soap');
      if (modal && !modal.classList.contains('hidden') && modal.style.display !== 'none') {
        fecharModalEstacaoSoap();
      }
    }
  });
}

// --- 3. AUTO-SAVE (LOCALSTORAGE) E PERSISTÊNCIA (INDEXEDDB) ---
function agendarAutoSaveSoap() {
  if (debounceTimerSoap) clearTimeout(debounceTimerSoap);
  debounceTimerSoap = setTimeout(() => {
    try {
      localStorage.setItem(SOAP_DRAFT_KEY, JSON.stringify(soapDraft));
      const statusEl = document.getElementById('soap-autosave-status');
      if (statusEl) {
        statusEl.textContent = 'Rascunho salvo automaticamente';
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
      }
    } catch (err) {
      console.warn('[Estação SOAP] Falha ao salvar rascunho no localStorage:', err);
    }
  }, 300);
}

function restaurarRascunhoSoap() {
  try {
    const saved = localStorage.getItem(SOAP_DRAFT_KEY);
    if (!saved) return;

    const parsed = JSON.parse(saved);
    soapDraft = { ...soapDraft, ...parsed };

    const setVal = (id, val, isCheck = false) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (isCheck) el.checked = Boolean(val);
      else el.value = val ?? '';
    };

    setVal('soap-idade', soapDraft.idade);
    setVal('soap-sexo', soapDraft.sexo);
    setVal('soap-gestante', soapDraft.gestante, true);
    setVal('soap-alergias', soapDraft.alergias);
    setVal('soap-pas', soapDraft.pas);
    setVal('soap-pad', soapDraft.pad);
    setVal('soap-fc', soapDraft.fc);
    setVal('soap-fr', soapDraft.fr);
    setVal('soap-spo2', soapDraft.spo2);
    setVal('soap-tax', soapDraft.tax);
    setVal('soap-peso', soapDraft.peso);
    setVal('soap-altura', soapDraft.altura);
    setVal('soap-brain-dump', soapDraft.brain_dump);
  } catch (err) {
    console.warn('[Estação SOAP] Erro ao restaurar rascunho:', err);
  }
}

function limparFormularioSoap() {
  soapDraft = {
    idade: '', sexo: '', gestante: false, alergias: '',
    pas: '', pad: '', fc: '', fr: '', spo2: '', tax: '',
    peso: '', altura: '', brain_dump: ''
  };
  localStorage.removeItem(SOAP_DRAFT_KEY);
  restaurarRascunhoSoap();
  calcularMetricasReativas();
  
  const resContainer = document.getElementById('soap-resultado-container');
  const alertContainer = document.getElementById('soap-alertas-container');
  if (resContainer) resContainer.innerHTML = '';
  if (alertContainer) alertContainer.innerHTML = '';
}

function initSoapIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      console.warn('[Estação SOAP] IndexedDB não suportado neste navegador.');
      return resolve(null);
    }

    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => {
      console.error('[Estação SOAP] Erro ao abrir IndexedDB:', event.target.error);
      resolve(null);
    };
  });
}

async function salvarNoHistoricoIndexedDB(payloadEnviado, resultadoApi) {
  const db = await initSoapIndexedDB();
  if (!db) return;

  try {
    const tx = db.transaction([IDB_STORE], 'readwrite');
    const store = tx.objectStore(IDB_STORE);

    const registro = {
      timestamp: new Date().toISOString(),
      input: { ...payloadEnviado },
      output: resultadoApi
    };

    store.add(registro);

    // Manter apenas os últimos 50 atendimentos
    const countReq = store.count();
    countReq.onsuccess = () => {
      const total = countReq.result;
      if (total > MAX_HISTORY_ITEMS) {
        const excesso = total - MAX_HISTORY_ITEMS;
        const cursorReq = store.index('timestamp').openCursor();
        let deletados = 0;
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && deletados < excesso) {
            store.delete(cursor.primaryKey);
            deletados++;
            cursor.continue();
          }
        };
      }
    };
  } catch (err) {
    console.warn('[Estação SOAP] Erro ao gravar no histórico IndexedDB:', err);
  }
}

// --- 4. CÁLCULO REATIVO CLIENT-SIDE (PAM e IMC) ---
function calcularMetricasReativas() {
  const pas = parseFloat(soapDraft.pas || document.getElementById('soap-pas')?.value);
  const pad = parseFloat(soapDraft.pad || document.getElementById('soap-pad')?.value);
  const badgePam = document.getElementById('badge-pam-live');

  if (badgePam) {
    if (!isNaN(pas) && !isNaN(pad) && pas > 0 && pad > 0) {
      const pam = Math.round((pas + 2 * pad) / 3);
      let statusClass = 'badge-normal';
      if (pam < 65) statusClass = 'badge-critico';
      else if (pam > 110) statusClass = 'badge-alerta';

      badgePam.textContent = `PAM: ${pam} mmHg`;
      badgePam.className = `soap-live-badge ${statusClass}`;
      badgePam.style.display = 'inline-block';
    } else {
      badgePam.textContent = 'PAM: --';
      badgePam.className = 'soap-live-badge';
    }
  }

  const peso = parseFloat(soapDraft.peso || document.getElementById('soap-peso')?.value);
  let altura = parseFloat(soapDraft.altura || document.getElementById('soap-altura')?.value);
  const badgeImc = document.getElementById('badge-imc-live');

  if (badgeImc) {
    if (!isNaN(peso) && !isNaN(altura) && peso > 0 && altura > 0) {
      // Suporta altura em cm (ex: 175) ou em metros (ex: 1.75)
      const altMetros = altura > 3 ? altura / 100 : altura;
      const imc = peso / (altMetros * altMetros);
      const imcFormatado = imc.toFixed(1);

      let classificacao = '';
      if (imc < 18.5) classificacao = 'Baixo Peso';
      else if (imc < 25) classificacao = 'Eutrófico';
      else if (imc < 30) classificacao = 'Sobrepeso';
      else classificacao = 'Obesidade';

      badgeImc.textContent = `IMC: ${imcFormatado} kg/m² (${classificacao})`;
      badgeImc.style.display = 'inline-block';
    } else {
      badgeImc.textContent = 'IMC: --';
    }
  }
}

// --- 5. DITADO POR VOZ NATIVO (WEB SPEECH API) ---
function toggleDitadoVozSoap() {
  if (isRecordingSoap) {
    pararDitadoVozSoap();
  } else {
    iniciarDitadoVozSoap();
  }
}

function iniciarDitadoVozSoap() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btnMic = document.getElementById('btn-soap-mic');
  const textarea = document.getElementById('soap-brain-dump');

  if (!SpeechRecognition) {
    alert('Seu navegador não suporta ditado por voz nativo (Web Speech API). Recomendamos o uso do Google Chrome ou Microsoft Edge.');
    return;
  }

  if (isRecordingSoap) return;

  soapSpeechRecognition = new SpeechRecognition();
  soapSpeechRecognition.lang = 'pt-BR';
  soapSpeechRecognition.continuous = true;
  soapSpeechRecognition.interimResults = true;

  textBeforeSpeech = textarea ? textarea.value : (soapDraft.brain_dump || '');
  if (textBeforeSpeech && !textBeforeSpeech.endsWith(' ') && !textBeforeSpeech.endsWith('\n')) {
    textBeforeSpeech += ' ';
  }

  soapSpeechRecognition.onstart = () => {
    isRecordingSoap = true;
    if (btnMic) {
      btnMic.classList.add('pulse');
      btnMic.dataset.originalLabel = btnMic.innerHTML;
      btnMic.innerHTML = '🔴 Gravando...';
    }
  };

  soapSpeechRecognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      textBeforeSpeech += finalTranscript;
    }

    const combinedText = textBeforeSpeech + interimTranscript;
    if (textarea) {
      textarea.value = combinedText;
      textarea.scrollTop = textarea.scrollHeight;
    }
    soapDraft.brain_dump = combinedText;
    agendarAutoSaveSoap();
  };

  soapSpeechRecognition.onerror = (event) => {
    console.warn('[Estação SOAP] Erro no reconhecimento de voz:', event.error);
    pararDitadoVozSoap();
  };

  soapSpeechRecognition.onend = () => {
    if (isRecordingSoap) {
      pararDitadoVozSoap();
    }
  };

  try {
    soapSpeechRecognition.start();
  } catch (err) {
    console.error('[Estação SOAP] Falha ao iniciar microfone:', err);
    pararDitadoVozSoap();
  }
}

function pararDitadoVozSoap() {
  isRecordingSoap = false;
  if (soapSpeechRecognition) {
    try {
      soapSpeechRecognition.stop();
    } catch (_) {}
  }

  const btnMic = document.getElementById('btn-soap-mic');
  if (btnMic) {
    btnMic.classList.remove('pulse');
    btnMic.innerHTML = btnMic.dataset.originalLabel || '🎤 Ditar Caso';
  }
}

// --- 6. ENVIO PARA A API E RENDERIZAÇÃO ---
function coletarDadosFormularioSoap() {
  const getVal = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    return el.type === 'checkbox' ? el.checked : el.value.trim();
  };

  soapDraft = {
    idade: getVal('soap-idade', soapDraft.idade),
    sexo: getVal('soap-sexo', soapDraft.sexo),
    gestante: getVal('soap-gestante', soapDraft.gestante),
    alergias: getVal('soap-alergias', soapDraft.alergias),
    pas: getVal('soap-pas', soapDraft.pas),
    pad: getVal('soap-pad', soapDraft.pad),
    fc: getVal('soap-fc', soapDraft.fc),
    fr: getVal('soap-fr', soapDraft.fr),
    spo2: getVal('soap-spo2', soapDraft.spo2),
    tax: getVal('soap-tax', soapDraft.tax),
    peso: getVal('soap-peso', soapDraft.peso),
    altura: getVal('soap-altura', soapDraft.altura),
    brain_dump: getVal('soap-brain-dump', soapDraft.brain_dump)
  };

  return { ...soapDraft };
}

async function enviarParaEstacaoSoap(modelOverride = null) {
  if (isRecordingSoap) pararDitadoVozSoap();

  const dados = coletarDadosFormularioSoap();
  const textarea = document.getElementById('soap-brain-dump');
  const alertContainer = document.getElementById('soap-alertas-container');
  const resContainer = document.getElementById('soap-resultado-container');

  if (!dados.brain_dump || dados.brain_dump.trim().length < 3) {
    if (alertContainer) {
      alertContainer.innerHTML = `
        <div class="soap-alert soap-alert-warning" style="padding:12px; border-left:4px solid #f59e0b; background:#fffbeb; color:#92400e; border-radius:6px; margin-bottom:12px;">
          ⚠️ <strong>Atenção:</strong> Insira ou dite pelo menos um resumo clínico (mínimo de 3 caracteres) no campo de anotações livres antes de gerar a evolução.
        </div>`;
    } else {
      alert('Insira ou dite o caso clínico (mínimo de 3 caracteres).');
    }
    if (textarea) textarea.focus();
    return;
  }

  if (alertContainer) alertContainer.innerHTML = '';
  if (resContainer) {
    resContainer.innerHTML = `
      <div class="soap-loading-state" style="display:flex; align-items:center; gap:12px; padding:24px; background:rgba(15,23,42,0.04); border-radius:8px; font-weight:500;">
        <span class="soap-spinner" style="display:inline-block; width:20px; height:20px; border:3px solid rgba(59,130,246,0.3); border-top-color:#2563eb; border-radius:50%; animation:spin 0.8s linear infinite;"></span>
        <span>⚡ Processando com IA Clínica e diretrizes brasileiras...</span>
      </div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
  }

  const patientContext = {
    idade: dados.idade !== undefined && dados.idade !== '' ? Number(dados.idade) : undefined,
    sexo: dados.sexo ? String(dados.sexo).trim().toUpperCase() : undefined,
    gestante: Boolean(dados.gestante === true || dados.gestante === 'true' || dados.gestante === '1'),
    alergias: dados.alergias ? (Array.isArray(dados.alergias) ? dados.alergias : [String(dados.alergias).trim()]) : []
  };

  const vitals = {};
  if (dados.pas) vitals.pas = Number(dados.pas);
  if (dados.pad) vitals.pad = Number(dados.pad);
  if (dados.fc) vitals.fc = Number(dados.fc);
  if (dados.fr) vitals.fr = Number(dados.fr);
  if (dados.spo2) vitals.spo2 = Number(dados.spo2);
  if (dados.tax) vitals.tax = Number(dados.tax);
  if (dados.peso) vitals.peso = Number(dados.peso);
  if (dados.altura) vitals.altura = Number(dados.altura);

  const payload = {
    ...dados,
    patient_context: patientContext,
    vitals: vitals,
    sinais_vitais: vitals
  };

  if (modelOverride) {
    payload.model_override = modelOverride;
  }

  try {
    const apiBase = getSoapApiBase();
    const response = await fetch(`${apiBase}/api/clinical/soap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let errMsg = `Erro HTTP ${response.status}`;
      try {
        const errData = await response.json();
        errMsg = errData.error || errData.message || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const result = await response.json();
    lastSoapResult = result;

    renderizarResultadoSoap(result, dados);
    await salvarNoHistoricoIndexedDB(payload, result);
  } catch (err) {
    console.error('[Estação SOAP] Erro na chamada /api/clinical/soap:', err);
    if (resContainer) {
      resContainer.innerHTML = `
        <div class="soap-error-box" style="padding:16px; border-left:4px solid #ef4444; background:#fef2f2; color:#991b1b; border-radius:6px;">
          <strong>❌ Falha ao processar evolução SOAP:</strong> ${escapeHtmlSoap(err.message)}
          <div style="margin-top:8px;">
            <button type="button" onclick="enviarParaEstacaoSoap(${modelOverride ? `'${modelOverride}'` : 'null'})" style="padding:6px 12px; cursor:pointer;">🔄 Tentar Novamente</button>
          </div>
        </div>
      `;
    }
  }
}

/**
 * Helpers para desestruturação segura dos nós do SOAP para evitar [object Object] na UI.
 */
function extrairTextoSubjetivo(s) {
  if (!s) return '-';
  if (typeof s === 'string') return s;
  if (s.texto_unificado) return s.texto_unificado;
  const partes = [];
  if (s.qp) partes.push(`QP: ${s.qp}`);
  if (s.hda) partes.push(`HDA: ${s.hda}`);
  if (s.hpp) partes.push(`HPP: ${s.hpp}`);
  if (s.medicamentos_em_uso) partes.push(`Medicamentos em uso: ${s.medicamentos_em_uso}`);
  if (s.revisao_sistemas) partes.push(`Revisão de Sistemas: ${s.revisao_sistemas}`);
  return partes.length > 0 ? partes.join('\n\n') : JSON.stringify(s, null, 2);
}

function extrairTextoObjetivo(o) {
  if (!o) return '-';
  if (typeof o === 'string') return o;
  if (o.texto_unificado) return o.texto_unificado;
  const partes = [];
  if (o.ectoscopia) partes.push(`Ectoscopia: ${o.ectoscopia}`);
  if (o.sinais_vitais_texto) partes.push(`Sinais Vitais: ${o.sinais_vitais_texto}`);
  if (o.exame_fisico_direcionado) partes.push(`Exame Físico: ${o.exame_fisico_direcionado}`);
  if (o.exames_complementares_citados) partes.push(`Exames Complementares: ${o.exames_complementares_citados}`);
  return partes.length > 0 ? partes.join('\n\n') : JSON.stringify(o, null, 2);
}

function extrairTextoAvaliacao(a) {
  if (!a) return '-';
  if (typeof a === 'string') return a;
  const partes = [];
  if (Array.isArray(a.hipoteses_diagnosticas) && a.hipoteses_diagnosticas.length > 0) {
    const hdLines = a.hipoteses_diagnosticas.map(h => {
      const cid = h.cid10 ? `[${h.cid10}] ` : '';
      const prob = h.probabilidade ? ` (${h.probabilidade})` : '';
      const just = h.justificativa ? ` - ${h.justificativa}` : '';
      return `• ${cid}${h.diagnostico || 'Hipótese'}${prob}${just}`;
    });
    partes.push(`HIPÓTESES DIAGNÓSTICAS:\n${hdLines.join('\n')}`);
  }
  if (a.raciocinio_clinico) partes.push(`RACIOCÍNIO CLÍNICO:\n${a.raciocinio_clinico}`);
  if (Array.isArray(a.red_flags) && a.red_flags.length > 0) {
    partes.push(`SINAIS DE ALARME (RED FLAGS):\n${a.red_flags.map(r => `• ${r}`).join('\n')}`);
  }
  return partes.length > 0 ? partes.join('\n\n') : JSON.stringify(a, null, 2);
}

function extrairTextoPlano(p) {
  if (!p) return '-';
  if (typeof p === 'string') return p;
  const partes = [];
  if (p.conduta_imediata) partes.push(`CONDUTA IMEDIATA:\n${p.conduta_imediata}`);
  if (Array.isArray(p.prescricao) && p.prescricao.length > 0) {
    const rxLines = p.prescricao.map((item, idx) => {
      if (typeof item === 'string') return `${idx + 1}. ${item}`;
      const nome = item.item || item.medicamento || item.nome || 'Item';
      const dose = item.dose ? ` ${item.dose}` : '';
      const via = item.via ? ` (${item.via})` : '';
      const pos = item.posologia || item.instrucoes || '';
      const dur = item.duracao ? ` por ${item.duracao}` : '';
      return `${idx + 1}. ${nome}${dose}${via}\n   ${pos}${dur}`.trim();
    });
    partes.push(`PRESCRIÇÃO:\n${rxLines.join('\n\n')}`);
  }
  if (Array.isArray(p.exames_solicitados) && p.exames_solicitados.length > 0) {
    partes.push(`EXAMES SOLICITADOS:\n${p.exames_solicitados.map(e => `• ${e}`).join('\n')}`);
  }
  if (p.orientacoes_e_sinais_alarme) partes.push(`ORIENTAÇÕES E SINAIS DE ALARME:\n${p.orientacoes_e_sinais_alarme}`);
  if (p.criterios_reavaliacao) partes.push(`CRITÉRIOS DE REAVALIAÇÃO:\n${p.criterios_reavaliacao}`);
  return partes.length > 0 ? partes.join('\n\n') : JSON.stringify(p, null, 2);
}

function renderizarResultadoSoap(result, dadosInput) {
  const alertContainer = document.getElementById('soap-alertas-container');
  const resContainer = document.getElementById('soap-resultado-container');

  // Normaliza campos da resposta da API
  const data = result.data || result;
  const soapObj = data.soap || {};
  const subjRaw = soapObj.subjetivo_formatado || soapObj.subjetivo || data.subjetivo || data.S || '';
  const objRaw = soapObj.objetivo_formatado || soapObj.objetivo || data.objetivo || data.O || '';
  const avalRaw = soapObj.avaliacao || data.avaliacao || data.A || '';
  const planoRaw = soapObj.plano || data.plano || data.P || '';

  const textoSubjetivo = extrairTextoSubjetivo(subjRaw);
  const textoObjetivo = extrairTextoObjetivo(objRaw);
  const textoAvaliacao = extrairTextoAvaliacao(avalRaw);
  const textoPlano = extrairTextoPlano(planoRaw);

  const safetyAlerts = data.safety_analysis?.alerts || [];
  const redFlags = data.red_flags || (avalRaw && avalRaw.red_flags) || data.alertas || [];
  const alergiasAlert = data.alergias_alerta || (dadosInput?.alergias ? [`Alergia relatada: ${dadosInput.alergias}`] : []);
  const prescricaoRaw = (planoRaw && planoRaw.prescricao) || data.prescricao || data.prescricao_sugerida || '';
  const referencias = soapObj.referencias_bibliograficas || data.referencias || data.diretrizes || [];

  // 1. Renderizar Alertas (Safety Alerts + Red Flags + Alergias)
  if (alertContainer) {
    let alertsHtml = '';

    if (data.has_critical_alerts || safetyAlerts.some(a => a.severity === 'CRITICAL')) {
      alertsHtml += `
        <div class="soap-alert-critico" style="padding:14px 16px; margin-bottom:12px; border-left:5px solid #b91c1c; background:#fef2f2; color:#991b1b; border-radius:6px; font-weight:600;">
          🚨 ATENÇÃO BEIRA-LEITO: Risco ou contraindicação médica crítica detectada na conduta!
        </div>`;
    }

    if (safetyAlerts && safetyAlerts.length > 0) {
      alertsHtml += safetyAlerts.map(a => {
        const isCrit = a.severity === 'CRITICAL';
        const corBorda = isCrit ? '#dc2626' : '#ea580c';
        const corBg = isCrit ? '#fef2f2' : '#fff7ed';
        const corTexto = isCrit ? '#991b1b' : '#9a3412';
        return `
          <div class="soap-alert-item" style="padding:12px 16px; margin-bottom:10px; border-left:4px solid ${corBorda}; background:${corBg}; color:${corTexto}; border-radius:6px;">
            <strong>${escapeHtmlSoap(a.title || 'Alerta de Segurança')}:</strong> ${escapeHtmlSoap(a.description || '')}
          </div>`;
      }).join('');
    }

    if (alergiasAlert && alergiasAlert.length > 0 && !safetyAlerts.some(a => a.type === 'CONTRAINDICATION_ALLERGY')) {
      const listaAlergias = Array.isArray(alergiasAlert) ? alergiasAlert : [alergiasAlert];
      alertsHtml += `
        <div class="soap-alert-alergia" style="padding:12px 16px; margin-bottom:10px; border-left:4px solid #dc2626; background:#fef2f2; color:#991b1b; border-radius:6px;">
          <strong>🚫 ALERTA DE ALERGIA / SEGURANÇA:</strong>
          <ul style="margin:6px 0 0 18px; padding:0;">
            ${listaAlergias.map(a => `<li>${escapeHtmlSoap(String(a))}</li>`).join('')}
          </ul>
        </div>`;
    }

    if (redFlags && redFlags.length > 0) {
      const listaFlags = Array.isArray(redFlags) ? redFlags : [redFlags];
      alertsHtml += `
        <div class="soap-alert-redflags" style="padding:12px 16px; margin-bottom:12px; border-left:4px solid #ea580c; background:#fff7ed; color:#9a3412; border-radius:6px;">
          <strong>🚨 SINAIS DE ALARME (RED FLAGS):</strong>
          <ul style="margin:6px 0 0 18px; padding:0;">
            ${listaFlags.map(rf => `<li>${escapeHtmlSoap(String(rf))}</li>`).join('')}
          </ul>
        </div>`;
    }

    alertContainer.innerHTML = alertsHtml;
  }

  // 2. Montar texto limpo para cópia do SOAP e da Prescrição
  const textoSoapLimpo = data.clipboard?.prontuario_soap || [
    `# EVOLUÇÃO CLÍNICA (SOAP)`,
    `[S - SUBJETIVO]\n${textoSubjetivo}`,
    `[O - OBJETIVO]\n${textoObjetivo}`,
    `[A - AVALIAÇÃO]\n${textoAvaliacao}`,
    `[P - PLANO]\n${textoPlano}`
  ].join('\n\n');

  let textoPrescricaoLimpo = data.clipboard?.receituario || '';
  if (!textoPrescricaoLimpo) {
    if (Array.isArray(prescricaoRaw)) {
      textoPrescricaoLimpo = prescricaoRaw.map((item, idx) => {
        if (typeof item === 'string') return `${idx + 1}. ${item}`;
        const nome = item.item || item.medicamento || item.nome || 'Item';
        const dose = item.dose ? ` ${item.dose}` : '';
        const posologia = item.posologia || item.instrucoes || item.como_usar || '';
        const via = item.via ? `(${item.via})` : '';
        return `${idx + 1}. ${nome}${dose} ${via}\n   ${posologia}`.trim();
      }).join('\n\n');
    } else {
      textoPrescricaoLimpo = String(prescricaoRaw || 'Nenhuma prescrição farmacológica específica gerada.');
    }
  }

  // Guarda nos atributos globais para cópia rápida
  window.__lastSoapTextToCopy = textoSoapLimpo;
  window.__lastPrescricaoTextToCopy = textoPrescricaoLimpo;

  // 3. Renderizar Blocos S + O + A + P, Prescrição, Referências e Botão Gemini 4 Argon
  if (resContainer) {
    const refBadgesHtml = Array.isArray(referencias) && referencias.length > 0
      ? `<div class="soap-referencias-box" style="margin-top:16px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
          <span style="font-size:12px; font-weight:600; opacity:0.75;">📚 Diretrizes e Referências:</span>
          ${referencias.map(ref => `<span class="soap-ref-badge" style="font-size:11px; padding:3px 8px; background:rgba(59,130,246,0.12); color:#1d4ed8; border-radius:999px; font-weight:500;">${escapeHtmlSoap(typeof ref === 'object' ? (ref.titulo || ref.fonte || JSON.stringify(ref)) : String(ref))}</span>`).join('')}
         </div>`
      : '';

    resContainer.innerHTML = `
      <div class="soap-result-card" style="border:1px solid rgba(148,163,184,0.3); border-radius:8px; padding:16px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h4 style="margin:0; font-size:16px;">📄 Evolução Estruturada (SOAP)</h4>
          <button type="button" class="btn-soap-copy" onclick="copiarTextoParaClipboard(window.__lastSoapTextToCopy, this, '✅ Copiado!')" style="padding:6px 12px; cursor:pointer; font-weight:600; border-radius:6px;">
            📋 Copiar Evolução SOAP
          </button>
        </div>

        <div class="soap-grid" style="display:grid; gap:10px;">
          <div style="padding:10px; background:rgba(15,23,42,0.03); border-radius:6px;">
            <strong>[S] Subjetivo:</strong>
            <div style="white-space:pre-wrap; margin-top:4px;">${escapeHtmlSoap(textoSubjetivo)}</div>
          </div>
          <div style="padding:10px; background:rgba(15,23,42,0.03); border-radius:6px;">
            <strong>[O] Objetivo:</strong>
            <div style="white-space:pre-wrap; margin-top:4px;">${escapeHtmlSoap(textoObjetivo)}</div>
          </div>
          <div style="padding:10px; background:rgba(15,23,42,0.03); border-radius:6px;">
            <strong>[A] Avaliação Clínica / Hipóteses:</strong>
            <div style="white-space:pre-wrap; margin-top:4px;">${escapeHtmlSoap(textoAvaliacao)}</div>
          </div>
          <div style="padding:10px; background:rgba(15,23,42,0.03); border-radius:6px;">
            <strong>[P] Plano Terapêutico e Conduta:</strong>
            <div style="white-space:pre-wrap; margin-top:4px;">${escapeHtmlSoap(textoPlano)}</div>
          </div>
        </div>
      </div>

      <div class="soap-prescricao-card" style="border:1px solid rgba(148,163,184,0.3); border-radius:8px; padding:16px; margin-bottom:16px; background:rgba(15,23,42,0.4);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <h4 style="margin:0; font-size:15px; font-weight:bold; color:#f8fafc; display:flex; items-center; gap:6px;">
            <span>💊</span> Receituário Médico Oficial
          </h4>
          <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
            <button type="button" onclick="exportarPrescricaoDocx()" title="Baixar documento do Word (.docx) formatado para impressão" style="padding:6px 12px; cursor:pointer; font-weight:700; border-radius:8px; background:#1e40af; color:#fff; border:1px solid #3b82f6; font-size:11.5px; display:inline-flex; align-items:center; gap:5px; transition:all 0.2s;">
              <span>📄</span> Baixar (.docx)
            </button>
            <button type="button" onclick="exportarPrescricaoPdfEditavel()" title="Abrir visualizador com campos editáveis antes de salvar em PDF ou imprimir" style="padding:6px 12px; cursor:pointer; font-weight:700; border-radius:8px; background:#0f766e; color:#fff; border:1px solid #14b8a6; font-size:11.5px; display:inline-flex; align-items:center; gap:5px; transition:all 0.2s;">
              <span>📑</span> PDF Editável
            </button>
            <button type="button" class="btn-soap-copy-rx" onclick="copiarTextoParaClipboard(window.__lastPrescricaoTextToCopy, this, '✅ Copiado!')" style="padding:6px 12px; cursor:pointer; font-weight:600; border-radius:8px; background:#334155; color:#f8fafc; border:1px solid #475569; font-size:11.5px; display:inline-flex; align-items:center; gap:5px;">
              <span>💊</span> Copiar Texto
            </button>
          </div>
        </div>
        <pre style="white-space:pre-wrap; font-family:inherit; margin:0; padding:12px; background:rgba(15,23,42,0.6); border-radius:6px; font-size:12px; color:#e2e8f0; line-height:1.5;">${escapeHtmlSoap(textoPrescricaoLimpo)}</pre>
      </div>

      ${refBadgesHtml}

      <div class="soap-actions-footer" style="margin-top:16px; display:flex; justify-content:flex-end; gap:10px; border-top:1px solid rgba(148,163,184,0.15); padding-top:14px;">
        <button type="button" class="btn-soap-deepen" id="btn-soap-deepen" onclick="enviarParaEstacaoSoap('gemini-4-argon')" style="padding:8px 16px; cursor:pointer; font-weight:700; border-radius:8px; background:linear-gradient(135deg, #4f46e5, #3730a3); color:#fff; border:none; display:inline-flex; align-items:center; gap:8px; font-size:12px; box-shadow:0 2px 8px rgba(79, 70, 229, 0.35);">
          <span>🧠</span> Aprofundar Raciocínio Clínico
        </button>
      </div>
    `;
  }
}

// --- 7. FUNÇÕES DE CÓPIA COM 1 CLIQUE ---
async function copiarTextoParaClipboard(texto, btnElement, feedbackMsg = '✅ Copiado!') {
  if (!texto) return;

  let copiadoComSucesso = false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(texto);
      copiadoComSucesso = true;
    } catch (err) {
      console.warn('[Estação SOAP] Fallback para execCommand devido a erro na Clipboard API:', err);
    }
  }

  if (!copiadoComSucesso) {
    const tempTextArea = document.createElement('textarea');
    tempTextArea.value = texto;
    tempTextArea.style.position = 'fixed';
    tempTextArea.style.left = '-9999px';
    tempTextArea.style.top = '0';
    document.body.appendChild(tempTextArea);
    tempTextArea.focus();
    tempTextArea.select();

    try {
      document.execCommand('copy');
      copiadoComSucesso = true;
    } catch (err) {
      console.error('[Estação SOAP] Erro ao copiar texto:', err);
    } finally {
      document.body.removeChild(tempTextArea);
    }
  }

  if (copiadoComSucesso && btnElement) {
    const originalHtml = btnElement.dataset.originalHtml || btnElement.innerHTML;
    btnElement.dataset.originalHtml = originalHtml;
    btnElement.innerHTML = feedbackMsg;
    btnElement.disabled = true;

    setTimeout(() => {
      btnElement.innerHTML = originalHtml;
      btnElement.disabled = false;
    }, 2000);
  }
}

// --- 8. CONTROLE DE MODAL (ABRIR / FECHAR) ---
function abrirModalEstacaoSoap() {
  const modal = document.getElementById('modal-estacao-soap');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }

  restaurarRascunhoSoap();
  calcularMetricasReativas();
  if (typeof CnesWorkplaceManager !== 'undefined') {
    CnesWorkplaceManager.init();
  }

  setTimeout(() => {
    const brainDump = document.getElementById('soap-brain-dump');
    if (brainDump) brainDump.focus();
  }, 100);
}

function fecharModalEstacaoSoap() {
  if (isRecordingSoap) {
    pararDitadoVozSoap();
  }

  const modal = document.getElementById('modal-estacao-soap');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
}

// --- 9. EXPORTAÇÃO DE RECEITUÁRIO MÉDICO (.DOCX E PDF EDITÁVEL) ---
function extrairDadosParaReceituario() {
  const idadeVal = document.getElementById('soap-idade')?.value?.trim();
  const sexoVal = document.getElementById('soap-sexo')?.value?.trim();
  const dataAtual = new Date().toLocaleDateString('pt-BR');

  let itensPrescricao = [];
  if (lastSoapResult && lastSoapResult.plano && Array.isArray(lastSoapResult.plano.prescricao)) {
    itensPrescricao = lastSoapResult.plano.prescricao;
  } else if (window.__lastPrescricaoTextToCopy) {
    const linhas = window.__lastPrescricaoTextToCopy.split('\n').filter(Boolean);
    itensPrescricao = linhas.map(l => ({ medicamento: l, posologia: '', via: 'USO ORAL' }));
  }

  const orientacoes = (lastSoapResult && lastSoapResult.plano && Array.isArray(lastSoapResult.plano.orientacoes_paciente))
    ? lastSoapResult.plano.orientacoes_paciente.join('\n')
    : '1. Manter hidratação adequada.\n2. Retornar imediatamente em caso de sinais de alarme (febre persistente, dispneia, piora clínica importante).';

  // Obtenção dinâmica do cabeçalho institucional via CNES ou Consultório Personalizado
  const cabCnes = (typeof window !== 'undefined' && window.CnesWorkplaceManager)
    ? window.CnesWorkplaceManager.obterDadosCabecalhoReceituario()
    : null;

  const instituicaoNome = (cabCnes && cabCnes.nome_unidade)
    ? (cabCnes.cnes ? `${cabCnes.nome_unidade} (CNES: ${cabCnes.cnes})` : cabCnes.nome_unidade)
    : (localStorage.getItem('rotina_clinica_nome') || 'SERVIÇO DE ATENDIMENTO MÉDICO / CONSULTÓRIO');

  const enderecoInstituicao = (cabCnes && cabCnes.endereco_completo)
    ? [cabCnes.endereco_completo, cabCnes.cidade_uf, cabCnes.cep ? `CEP: ${cabCnes.cep}` : '', cabCnes.telefone ? `Tel: ${cabCnes.telefone}` : ''].filter(Boolean).join(' • ')
    : (localStorage.getItem('rotina_clinica_endereco') || 'Unidade de Atendimento • SUS / Saúde Suplementar');

  return {
    instituicao: instituicaoNome,
    enderecoInstituicao: enderecoInstituicao,
    medicoNome: localStorage.getItem('rotina_medico_nome') || 'Dr(a). ____________________________________',
    medicoCrm: localStorage.getItem('rotina_medico_crm') || 'CRM/UF: ____________',
    paciente: {
      nome: 'Ao Portador / __________________________________________________',
      idade: idadeVal ? `${idadeVal} anos` : '____ anos',
      sexo: sexoVal === 'M' ? 'Masculino' : (sexoVal === 'F' ? 'Feminino' : '')
    },
    data: dataAtual,
    itens: itensPrescricao,
    orientacoes: orientacoes
  };
}

function construirHtmlReceituarioMedico(dados, modoEditavel = false) {
  const gruposPorVia = {};
  dados.itens.forEach(item => {
    const via = (item.via || 'USO ORAL').toUpperCase();
    if (!gruposPorVia[via]) gruposPorVia[via] = [];
    gruposPorVia[via].push(item);
  });

  let contadorMed = 1;
  let htmlMedicamentos = '';

  for (const [via, lista] of Object.entries(gruposPorVia)) {
    htmlMedicamentos += `
      <div style="margin-top: 14pt; margin-bottom: 6pt; font-weight: bold; font-size: 11pt; text-decoration: underline; color: #0f172a; letter-spacing: 0.5px;">
        ${via}
      </div>
    `;

    lista.forEach(item => {
      const conc = item.concentracao ? ` ${item.concentracao}` : '';
      const qtdStr = item.quantidade_dispensacao || item.quantidade ? ` ----------------------------- <b>${item.quantidade_dispensacao || item.quantidade}</b>` : '';
      const pos = item.posologia || 'Utilizar conforme orientação médica.';
      const dur = item.duracao ? ` (${item.duracao})` : '';

      htmlMedicamentos += `
        <div style="margin-bottom: 11pt; page-break-inside: avoid;">
          <div style="font-size: 11pt; font-weight: bold; color: #000000;">
            ${contadorMed}. ${item.medicamento}${conc}${qtdStr}
          </div>
          <div style="font-size: 10.5pt; color: #1e293b; margin-left: 18pt; margin-top: 2pt; line-height: 1.35;">
            &#8627; <i>${pos}${dur}</i>
          </div>
        </div>
      `;
      contadorMed++;
    });
  }

  const orientacoesHtml = dados.orientacoes
    ? `<div style="margin-top: 20pt; padding-top: 8pt; border-top: 1px dashed #94a3b8; page-break-inside: avoid;">
         <div style="font-weight: bold; font-size: 10.5pt; margin-bottom: 4pt; color: #0f172a;">ORIENTAÇÕES GERAIS AO PACIENTE:</div>
         <div style="font-size: 10pt; color: #1e293b; white-space: pre-line; line-height: 1.4;">${escapeHtmlSoap(dados.orientacoes)}</div>
       </div>`
    : '';

  const editAttr = modoEditavel ? 'contenteditable="true"' : '';

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <title>Receituário Médico - ${dados.data}</title>
      <!--[if gte mso 9]>
      <xml>
        <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
          <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
      </xml>
      <![endif]-->
      <style>
        @page {
          size: 21cm 29.7cm;
          margin: 2cm 2cm 2cm 2cm;
        }
        body {
          font-family: "Calibri", "Arial", sans-serif;
          color: #000000;
          line-height: 1.35;
          font-size: 11pt;
          margin: 0;
          padding: 0;
        }
        .receituario-container {
          max-width: 17cm;
          margin: 0 auto;
        }
        .header-table {
          width: 100%;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 6pt;
          margin-bottom: 12pt;
        }
        .patient-box {
          width: 100%;
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          padding: 6pt 10pt;
          margin-bottom: 16pt;
          border-radius: 4px;
        }
        .title-rx {
          text-align: center;
          font-size: 15pt;
          font-weight: 800;
          letter-spacing: 2px;
          margin: 12pt 0;
          color: #0f172a;
        }
        .footer-signature {
          width: 100%;
          margin-top: 36pt;
          page-break-inside: avoid;
        }
      </style>
    </head>
    <body>
      <div class="receituario-container" ${editAttr}>
        <table class="header-table" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center;">
              <div style="font-weight: bold; font-size: 13pt; text-transform: uppercase; color: #0f172a;">
                ${escapeHtmlSoap(dados.instituicao)}
              </div>
              <div style="font-size: 9.5pt; color: #475569; margin-top: 2pt;">
                ${escapeHtmlSoap(dados.enderecoInstituicao)}
              </div>
            </td>
          </tr>
        </table>

        <div class="title-rx">RECEITUÁRIO MÉDICO</div>

        <table class="patient-box" cellpadding="3" cellspacing="0">
          <tr>
            <td style="font-size: 10.5pt; width: 70%;">
              <b>PACIENTE:</b> ${escapeHtmlSoap(dados.paciente.nome)}
            </td>
            <td style="font-size: 10.5pt; width: 30%; text-align: right;">
              <b>DATA:</b> ${escapeHtmlSoap(dados.data)}
            </td>
          </tr>
          <tr>
            <td style="font-size: 10pt; color: #334155;">
              <b>IDADE:</b> ${escapeHtmlSoap(dados.paciente.idade)} ${dados.paciente.sexo ? `&nbsp;|&nbsp; <b>SEXO:</b> ${escapeHtmlSoap(dados.paciente.sexo)}` : ''}
            </td>
            <td></td>
          </tr>
        </table>

        <div style="min-height: 280pt;">
          ${htmlMedicamentos}
          ${orientacoesHtml}
        </div>

        <table class="footer-signature" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width: 45%; vertical-align: bottom; font-size: 10pt; color: #334155;">
              Data: ${escapeHtmlSoap(dados.data)}
            </td>
            <td style="width: 55%; text-align: center; vertical-align: bottom;">
              <div style="border-top: 1px solid #000000; width: 85%; margin: 0 auto; padding-top: 4pt;">
                <div style="font-weight: bold; font-size: 10.5pt;">${escapeHtmlSoap(dados.medicoNome)}</div>
                <div style="font-size: 9.5pt; color: #334155;">${escapeHtmlSoap(dados.medicoCrm)}</div>
                <div style="font-size: 8.5pt; color: #64748b; margin-top: 2pt;">Assinatura e Carimbo Médico</div>
              </div>
            </td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;
}

function exportarPrescricaoDocx() {
  const dados = extrairDadosParaReceituario();
  const htmlCompleto = construirHtmlReceituarioMedico(dados, false);

  const dataArquivo = dados.data.replace(/\//g, '-');
  const nomeArquivo = `Receituario_Medico_${dataArquivo}.docx`;

  const blob = new Blob(['\ufeff', htmlCompleto], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document;charset=utf-8'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportarPrescricaoPdfEditavel() {
  const dados = extrairDadosParaReceituario();
  const htmlReceituario = construirHtmlReceituarioMedico(dados, true);

  const janelaPdf = window.open('', '_blank', 'width=900,height=850');
  if (!janelaPdf) {
    alert('Permita pop-ups no navegador para abrir o editor do Receituário Médico.');
    return;
  }

  const barraControle = `
    <div id="no-print-toolbar" style="background:#0f172a; color:#f8fafc; padding:12px 20px; font-family:sans-serif; display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; z-index:9999; box-shadow:0 2px 10px rgba(0,0,0,0.3);">
      <div>
        <strong style="font-size:14px;">📝 Receituário Médico Editável</strong>
        <span style="font-size:12px; color:#94a3b8; margin-left:10px;">Clique em qualquer texto para editar antes de imprimir ou salvar como PDF.</span>
      </div>
      <div style="display:flex; gap:10px;">
        <button onclick="window.print()" style="background:#10b981; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:bold; cursor:pointer;">
          🖨️ Imprimir / Salvar PDF
        </button>
        <button onclick="window.close()" style="background:#475569; color:#fff; border:none; padding:8px 12px; border-radius:6px; cursor:pointer;">
          Fechar
        </button>
      </div>
    </div>
    <style>
      @media print {
        #no-print-toolbar { display: none !important; }
        body { background: #fff !important; padding: 0 !important; }
        .receituario-container { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 0 !important; }
      }
      @media screen {
        body { background: #e2e8f0; padding-bottom: 40px; }
        .receituario-container {
          background: #ffffff;
          padding: 2cm;
          margin: 24px auto;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          border-radius: 4px;
          outline: none;
        }
        .receituario-container:focus {
          box-shadow: 0 0 0 2px #3b82f6, 0 4px 20px rgba(0,0,0,0.15);
        }
      }
    </style>
  `;

  const htmlFinal = htmlReceituario.replace('<body>', `<body>${barraControle}`);
  janelaPdf.document.open();
  janelaPdf.document.write(htmlFinal);
  janelaPdf.document.close();
}

// --- UTILITÁRIOS INTERNOS ---
function escapeHtmlSoap(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Exposição explícita no escopo global (window) para handlers inline no HTML
window.soapDraft = soapDraft;
window.lastSoapResult = lastSoapResult;
window.iniciarDitadoVozSoap = iniciarDitadoVozSoap;
window.pararDitadoVozSoap = pararDitadoVozSoap;
window.toggleDitadoVozSoap = toggleDitadoVozSoap;
window.calcularMetricasReativas = calcularMetricasReativas;
window.enviarParaEstacaoSoap = enviarParaEstacaoSoap;
window.copiarTextoParaClipboard = copiarTextoParaClipboard;
window.abrirModalEstacaoSoap = abrirModalEstacaoSoap;
window.fecharModalEstacaoSoap = fecharModalEstacaoSoap;
window.limparFormularioSoap = limparFormularioSoap;
window.exportarPrescricaoDocx = exportarPrescricaoDocx;
window.exportarPrescricaoPdfEditavel = exportarPrescricaoPdfEditavel;

/**
 * ============================================================================
 * MÓDULO: LOCAL DE TRABALHO ATUAL (CNES) & CABEÇALHO AUTOMÁTICO DE RECEITUÁRIO
 * Integrado no ecossistema Rotina / Cockpit PWA (Gemini 4 Argon)
 * ============================================================================
 */

const ROTINA_CNES_STORAGE_KEYS = {
  ATIVO: 'rotina_local_trabalho_ativo_v1',
  FAVORITOS: 'rotina_locais_favoritos_v1'
};

// Base offline enxuta de segurança caso o PWA esteja sem rede no plantão
const CNES_FALLBACK_OFFLINE = [
  {
    cnes: '2079798',
    ibge: '3543402',
    cidade: 'Ribeirão Preto',
    uf: 'SP',
    nome_fantasia: 'Unidade de Emergência do HCRP (UE-HCRP)',
    razao_social: 'Hospital das Clínicas da FMRP-USP - Unidade de Emergência',
    tipo: 'HOSPITAL',
    logradouro: 'Rua Bernardino de Campos, 1000',
    bairro: 'Centro',
    cep: '14015-130',
    telefone: '(16) 3602-1111'
  },
  {
    cnes: '7023911',
    ibge: '3543402',
    cidade: 'Ribeirão Preto',
    uf: 'SP',
    nome_fantasia: 'UPA 24h Treze de Maio (UPA Leste)',
    razao_social: 'Secretaria Municipal da Saúde de Ribeirão Preto - UPA Leste',
    tipo: 'UPA',
    logradouro: 'Av. Treze de Maio, 353',
    bairro: 'Jardim Paulistano',
    cep: '14090-260',
    telefone: '(16) 3977-9200'
  },
  {
    cnes: '2077485',
    ibge: '3550308',
    cidade: 'São Paulo',
    uf: 'SP',
    nome_fantasia: 'Hospital das Clínicas da FMUSP (HCFMUSP)',
    razao_social: 'Hospital das Clínicas da Faculdade de Medicina da USP',
    tipo: 'HOSPITAL',
    logradouro: 'Av. Dr. Enéas Carvalho de Aguiar, 255',
    bairro: 'Cerqueira César',
    cep: '05403-000',
    telefone: '(11) 2661-0000'
  }
];

const CnesWorkplaceManager = {
  localAtivo: null,
  favoritos: [],
  resultadosBusca: [],
  filtroTipoAtivo: '',

  async init() {
    this.carregarEstadoLocal();
    this.renderizarBarraTopo();
    this.injetarModalDOM();
  },

  carregarEstadoLocal() {
    try {
      const salvoAtivo = localStorage.getItem(ROTINA_CNES_STORAGE_KEYS.ATIVO);
      const salvoFavs = localStorage.getItem(ROTINA_CNES_STORAGE_KEYS.FAVORITOS);

      this.favoritos = salvoFavs ? JSON.parse(salvoFavs) : [CNES_FALLBACK_OFFLINE[0], CNES_FALLBACK_OFFLINE[1]];
      this.localAtivo = salvoAtivo ? JSON.parse(salvoAtivo) : this.favoritos[0] || CNES_FALLBACK_OFFLINE[0];
    } catch (e) {
      this.favoritos = [CNES_FALLBACK_OFFLINE[0]];
      this.localAtivo = CNES_FALLBACK_OFFLINE[0];
    }
  },

  salvarEstadoLocal() {
    try {
      if (this.localAtivo) {
        localStorage.setItem(ROTINA_CNES_STORAGE_KEYS.ATIVO, JSON.stringify(this.localAtivo));
      }
      localStorage.setItem(ROTINA_CNES_STORAGE_KEYS.FAVORITOS, JSON.stringify(this.favoritos));
      this.sincronizarIndexedDB();
    } catch (e) {
      console.warn('[CNES] Falha ao persistir local de trabalho:', e);
    }
  },

  sincronizarIndexedDB() {
    if (typeof indexedDB === 'undefined') return;
    try {
      const req = indexedDB.open('RotinaClinicalDB', 2);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('config_medico')) {
          db.createObjectStore('config_medico', { keyPath: 'id' });
        }
      };
      req.onsuccess = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('config_medico')) return;
        const tx = db.transaction('config_medico', 'readwrite');
        const store = tx.objectStore('config_medico');
        store.put({ id: 'local_trabalho_ativo', valor: this.localAtivo, updatedAt: Date.now() });
        store.put({ id: 'locais_favoritos', valor: this.favoritos, updatedAt: Date.now() });
      };
    } catch (_) {}
  },

  selecionarLocalAtivo(estabelecimento) {
    if (!estabelecimento) return;
    this.localAtivo = estabelecimento;
    this.salvarEstadoLocal();
    this.renderizarBarraTopo();
  },

  alternarFavorito(estabelecimento) {
    if (!estabelecimento || !estabelecimento.cnes) return;
    const idx = this.favoritos.findIndex((f) => f.cnes === estabelecimento.cnes);
    if (idx >= 0) {
      this.favoritos.splice(idx, 1);
    } else {
      this.favoritos.unshift(estabelecimento);
    }
    this.salvarEstadoLocal();
    this.renderizarBarraTopo();
    this.renderizarListaResultadosModal();
  },

  isFavorito(cnes) {
    return this.favoritos.some((f) => f.cnes === cnes);
  },

  obterDadosCabecalhoReceituario() {
    const est = this.localAtivo;
    if (!est) {
      return {
        nome_unidade: 'Consultório Médico',
        razao_social: '',
        cnes: '',
        endereco_completo: '',
        cidade_uf: '',
        cep: '',
        telefone: ''
      };
    }
    const isCustom = String(est.cnes || '').startsWith('CUSTOM-');
    return {
      nome_unidade: est.nome_fantasia || 'Unidade de Saúde',
      razao_social: est.razao_social || est.nome_fantasia || '',
      cnes: !isCustom && est.cnes ? est.cnes : '',
      tipo: est.tipo || 'UNIDADE',
      logradouro: est.logradouro || '',
      bairro: est.bairro || '',
      endereco_completo: [est.logradouro, est.bairro].filter(Boolean).join(' - '),
      cidade_uf: [est.cidade, est.uf].filter(Boolean).join('/'),
      cep: est.cep || '',
      telefone: est.telefone || ''
    };
  },

  renderizarBarraTopo() {
    let container = document.getElementById('rotina-cnes-workplace-bar');
    if (!container) {
      const modalCorpo = document.querySelector('#modal-estacao-soap > div');
      if (modalCorpo && modalCorpo.children.length >= 2) {
        container = document.createElement('div');
        container.id = 'rotina-cnes-workplace-bar';
        modalCorpo.insertBefore(container, modalCorpo.children[1]);
      }
    }
    if (!container) return;

    const ativo = this.localAtivo || {};
    const chipsFavoritos = this.favoritos
      .slice(0, 4)
      .map((fav) => {
        const isCurrent = ativo.cnes === fav.cnes;
        return `
          <button type="button"
            onclick="CnesWorkplaceManager.selecionarLocalPorCnes('${fav.cnes}')"
            style="padding:3px 10px; border-radius:999px; font-size:11px; cursor:pointer; border:1px solid ${
              isCurrent ? '#10b981' : '#334155'
            }; background:${isCurrent ? 'rgba(16,185,129,0.18)' : '#1e293b'}; color:${
              isCurrent ? '#6ee7b7' : '#cbd5e1'
            }; font-weight:${isCurrent ? '600' : '400'};">
            ⭐ ${fav.nome_fantasia}
          </button>
        `;
      })
      .join('');

    container.innerHTML = `
      <div style="background:#090d16; border-bottom:1px solid #1e293b; padding:8px 16px; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; font-family:system-ui,-apple-system,sans-serif;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="background:rgba(16,185,129,0.2); color:#6ee7b7; border:1px solid rgba(16,185,129,0.4); font-size:10.5px; font-weight:700; padding:2px 7px; border-radius:5px; letter-spacing:0.4px;">
            📍 ${ativo.tipo || 'LOCAL ATIVO'}
          </span>
          <strong style="color:#f8fafc; font-size:12.5px;">
            ${ativo.nome_fantasia || 'Selecionar Estabelecimento de Saúde'}
          </strong>
          <span style="color:#94a3b8; font-size:11.5px;">
            ${ativo.cidade ? `(${ativo.cidade}/${ativo.uf})` : ''}
            ${ativo.cnes && !String(ativo.cnes).startsWith('CUSTOM-') ? `• CNES ${ativo.cnes}` : ''}
          </span>
          <button type="button"
            onclick="CnesWorkplaceManager.abrirModal()"
            style="background:#2563eb; color:#ffffff; border:none; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:600; cursor:pointer;">
            Alterar Local
          </button>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <span style="color:#64748b; font-size:11px;">Meus Locais:</span>
          ${chipsFavoritos}
        </div>
      </div>
    `;
  },

  selecionarLocalPorCnes(cnes) {
    const encontrado =
      this.favoritos.find((f) => f.cnes === cnes) ||
      this.resultadosBusca.find((r) => r.cnes === cnes) ||
      CNES_FALLBACK_OFFLINE.find((o) => o.cnes === cnes);
    if (encontrado) {
      this.selecionarLocalAtivo(encontrado);
    }
  },

  injetarModalDOM() {
    if (document.getElementById('rotina-cnes-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'rotina-cnes-modal';
    modal.style.cssText =
      'display:none; position:fixed; inset:0; background:rgba(2,6,23,0.85); z-index:999999; align-items:center; justify-content:center; padding:16px; font-family:system-ui,-apple-system,sans-serif; backdrop-filter:blur(4px);';

    modal.innerHTML = `
      <div style="background:#0f172a; border:1px solid #334155; border-radius:12px; width:100%; max-width:680px; max-height:90vh; overflow-y:auto; color:#f8fafc; padding:20px; box-shadow:0 20px 50px rgba(0,0,0,0.7);">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:12px; margin-bottom:16px;">
          <div>
            <h3 style="margin:0; font-size:16px; font-weight:700; color:#f8fafc;">📍 Configurar Local de Trabalho (CNES / Consultório)</h3>
            <p style="margin:4px 0 0; font-size:11.5px; color:#94a3b8;">O cabeçalho do Receituário e Prontuário será preenchido automaticamente.</p>
          </div>
          <button type="button" onclick="CnesWorkplaceManager.fecharModal()" style="background:transparent; border:none; color:#94a3b8; font-size:22px; cursor:pointer;">✕</button>
        </div>

        <!-- Busca CNES -->
        <div style="display:grid; grid-template-columns: 1fr 1.4fr; gap:10px; margin-bottom:12px;">
          <div>
            <label style="font-size:11px; color:#94a3b8; display:block; margin-bottom:4px;">1. Cidade / Município</label>
            <input id="cnes-input-cidade" type="text" placeholder="Ex: Ribeirão Preto, São Paulo..." value="Ribeirão Preto"
              oninput="CnesWorkplaceManager.executarBusca()"
              style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid #334155; background:#1e293b; color:#fff; font-size:13px;" />
          </div>
          <div>
            <label style="font-size:11px; color:#94a3b8; display:block; margin-bottom:4px;">2. Buscar Hospital, UPA, UBS ou CNES</label>
            <input id="cnes-input-q" type="text" placeholder="Ex: HCRP, UPA Treze de Maio, Einstein..."
              oninput="CnesWorkplaceManager.executarBusca()"
              style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid #334155; background:#1e293b; color:#fff; font-size:13px;" />
          </div>
        </div>

        <!-- Filtros por Tipo -->
        <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
          ${['', 'HOSPITAL', 'UPA', 'UBS', 'CONSULTORIO']
            .map(
              (t) => `
            <button type="button" onclick="CnesWorkplaceManager.filtrarTipo('${t}')"
              style="padding:4px 10px; border-radius:6px; border:1px solid #334155; background:#1e293b; color:#e2e8f0; font-size:11px; cursor:pointer;">
              ${t || 'Todos os Tipos'}
            </button>`
            )
            .join('')}
        </div>

        <!-- Lista de Resultados -->
        <div id="cnes-lista-resultados" style="max-height:240px; overflow-y:auto; border:1px solid #1e293b; border-radius:8px; padding:8px; background:#020617; margin-bottom:16px;"></div>

        <!-- Cadastro de Consultório Particular / Personalizado -->
        <details style="background:#1e293b; border-radius:8px; padding:10px 12px; border:1px solid #334155;">
          <summary style="cursor:pointer; font-size:12.5px; font-weight:600; color:#93c5fd;">
            ➕ Cadastrar Consultório Particular / Clínica Personalizada
          </summary>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;">
            <input id="custom-cnes-nome" placeholder="Nome do Consultório / Clínica *" style="padding:7px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:12px;" />
            <input id="custom-cnes-codigo" placeholder="CNES (opcional)" style="padding:7px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:12px;" />
            <input id="custom-cnes-endereco" placeholder="Endereço (Rua, Número, Sala)" style="padding:7px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:12px;" />
            <input id="custom-cnes-bairro" placeholder="Bairro" style="padding:7px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:12px;" />
            <input id="custom-cnes-cidade" placeholder="Cidade (ex: Ribeirão Preto)" style="padding:7px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:12px;" />
            <input id="custom-cnes-uf" placeholder="UF (ex: SP)" maxlength="2" style="padding:7px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:12px;" />
            <input id="custom-cnes-cep" placeholder="CEP" style="padding:7px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:12px;" />
            <input id="custom-cnes-tel" placeholder="Telefone / WhatsApp" style="padding:7px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#fff; font-size:12px;" />
          </div>
          <button type="button" onclick="CnesWorkplaceManager.salvarPersonalizado()"
            style="margin-top:10px; width:100%; padding:8px; background:#10b981; color:#022c22; font-weight:700; border:none; border-radius:6px; cursor:pointer; font-size:12px;">
            Salvar e Ativar Consultório Personalizado
          </button>
        </details>
      </div>
    `;

    document.body.appendChild(modal);
  },

  abrirModal() {
    const modal = document.getElementById('rotina-cnes-modal');
    if (modal) {
      modal.style.display = 'flex';
      this.executarBusca();
    }
  },

  fecharModal() {
    const modal = document.getElementById('rotina-cnes-modal');
    if (modal) modal.style.display = 'none';
  },

  filtrarTipo(tipo) {
    this.filtroTipoAtivo = tipo;
    this.executarBusca();
  },

  async executarBusca() {
    const cidadeInput = document.getElementById('cnes-input-cidade');
    const qInput = document.getElementById('cnes-input-q');
    const cidade = cidadeInput ? cidadeInput.value.trim() : '';
    const q = qInput ? qInput.value.trim() : '';

    try {
      const apiBase = getSoapApiBase();
      const params = new URLSearchParams({
        cidade,
        q,
        tipo: this.filtroTipoAtivo || ''
      });
      const resp = await fetch(`${apiBase}/api/cnes/estabelecimentos?${params.toString()}`);
      if (resp.ok) {
        const data = await resp.json();
        this.resultadosBusca = data.estabelecimentos || [];
      } else {
        throw new Error('Fallback offline');
      }
    } catch (_) {
      const termo = (q + ' ' + cidade).toLowerCase();
      this.resultadosBusca = CNES_FALLBACK_OFFLINE.filter((item) =>
        `${item.nome_fantasia} ${item.cidade} ${item.tipo}`.toLowerCase().includes(termo.trim())
      );
    }

    this.renderizarListaResultadosModal();
  },

  renderizarListaResultadosModal() {
    const listEl = document.getElementById('cnes-lista-resultados');
    if (!listEl) return;

    if (!this.resultadosBusca.length) {
      listEl.innerHTML = `<div style="padding:14px; color:#64748b; font-size:12px; text-align:center;">Nenhum estabelecimento encontrado para este filtro.</div>`;
      return;
    }

    listEl.innerHTML = this.resultadosBusca
      .map((est) => {
        const fav = this.isFavorito(est.cnes);
        return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid #1e293b; gap:8px;">
          <div>
            <div style="font-size:12.5px; font-weight:600; color:#f1f5f9;">
              <span style="font-size:10px; background:#1e293b; color:#93c5fd; padding:1px 5px; border-radius:4px; margin-right:4px;">${est.tipo}</span>
              ${est.nome_fantasia}
            </div>
            <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
              ${est.logradouro || ''} - ${est.bairro || ''} • ${est.cidade}/${est.uf} ${est.cnes ? `(CNES: ${est.cnes})` : ''}
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button"
              onclick="CnesWorkplaceManager.alternarFavoritoPorCnes('${est.cnes}')"
              title="Favoritar local"
              style="background:#1e293b; border:1px solid #334155; color:${fav ? '#fbbf24' : '#64748b'}; border-radius:6px; padding:5px 8px; cursor:pointer;">
              ★
            </button>
            <button type="button"
              onclick="CnesWorkplaceManager.ativarResultPorCnes('${est.cnes}')"
              style="background:#2563eb; border:none; color:#fff; border-radius:6px; padding:5px 10px; font-size:11px; font-weight:600; cursor:pointer;">
              Usar Local
            </button>
          </div>
        </div>
      `;
      })
      .join('');
  },

  alternarFavoritoPorCnes(cnes) {
    const item = this.resultadosBusca.find((r) => r.cnes === cnes);
    if (item) this.alternarFavorito(item);
  },

  ativarResultPorCnes(cnes) {
    const item = this.resultadosBusca.find((r) => r.cnes === cnes);
    if (item) {
      this.selecionarLocalAtivo(item);
      this.fecharModal();
    }
  },

  async salvarPersonalizado() {
    const nome = document.getElementById('custom-cnes-nome')?.value?.trim();
    if (!nome) {
      alert('Informe o Nome do Consultório ou Unidade.');
      return;
    }

    const payload = {
      nome_fantasia: nome,
      razao_social: nome,
      cnes: document.getElementById('custom-cnes-codigo')?.value?.trim() || `CUSTOM-${Date.now().toString().slice(-6)}`,
      tipo: 'CONSULTORIO',
      logradouro: document.getElementById('custom-cnes-endereco')?.value?.trim() || '',
      bairro: document.getElementById('custom-cnes-bairro')?.value?.trim() || '',
      cidade: document.getElementById('custom-cnes-cidade')?.value?.trim() || 'Ribeirão Preto',
      uf: document.getElementById('custom-cnes-uf')?.value?.trim() || 'SP',
      cep: document.getElementById('custom-cnes-cep')?.value?.trim() || '',
      telefone: document.getElementById('custom-cnes-tel')?.value?.trim() || ''
    };

    try {
      const apiBase = getSoapApiBase();
      const resp = await fetch(`${apiBase}/api/cnes/personalizado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const data = await resp.json();
        this.alternarFavorito(data.estabelecimento);
        this.selecionarLocalAtivo(data.estabelecimento);
        this.fecharModal();
        return;
      }
    } catch (_) {}

    this.alternarFavorito(payload);
    this.selecionarLocalAtivo(payload);
    this.fecharModal();
  }
};

if (typeof window !== 'undefined') {
  window.CnesWorkplaceManager = CnesWorkplaceManager;
  document.addEventListener('DOMContentLoaded', () => {
    CnesWorkplaceManager.init();
  });
}