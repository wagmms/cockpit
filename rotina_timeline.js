/**
 * rotina_timeline.js
 * Módulo Desacoplado: Time-Blocking & Rotina Viva do Cockpit PWA
 * Gerencia a timeline diária do médico (plantão, estudos MedQuest/Anki, treino, recuperação).
 * Suporta ações rápidas em 1 toque, filtros, persistência local e sincronização resiliente.
 */

(function(window) {
  'use strict';

  var STORAGE_KEY = 'rotina_blocos_v1';
  var SYNC_STATE_KEY = 'rotina_sync_status_v1';
  var STORAGE_KEY_DUVIDAS = 'rotina_duvidas_v1';

  var CATEGORIA_CONFIG = {
    plantao: {
      rotulo: 'Plantão / Enfermaria',
      badgeCor: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      icone: 'stethoscope',
      borda: 'border-l-[3.5px] border-l-emerald-500'
    },
    estudo: {
      rotulo: 'MedQuest & Anki',
      badgeCor: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
      icone: 'book-open',
      borda: 'border-l-[3.5px] border-l-purple-500'
    },
    treino: {
      rotulo: 'Treino & Bio',
      badgeCor: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      icone: 'dumbbell',
      borda: 'border-l-[3.5px] border-l-amber-500'
    },
    recuperacao: {
      rotulo: 'Recuperação / Sono',
      badgeCor: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
      icone: 'moon',
      borda: 'border-l-[3.5px] border-l-indigo-500'
    },
    lifestyle: {
      rotulo: 'Vida & Lifestyle',
      badgeCor: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      icone: 'heart',
      borda: 'border-l-[3.5px] border-l-rose-500'
    },
    compromisso: {
      rotulo: 'Compromisso',
      badgeCor: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      icone: 'calendar',
      borda: 'border-l-[3.5px] border-l-sky-500'
    }
  };

  var STATUS_CONFIG = {
    concluido: {
      rotulo: 'Concluído',
      classe: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
      icone: 'check-circle'
    },
    ativo: {
      rotulo: 'Em Andamento',
      classe: 'bg-sky-500/20 text-sky-300 border border-sky-500/40 ring-1 ring-sky-400/40',
      icone: 'play-circle'
    },
    pendente: {
      rotulo: 'Pendente',
      classe: 'bg-slate-800/80 text-slate-300 border border-slate-700/80',
      icone: 'clock'
    },
    adiado: {
      rotulo: 'Adiado (+30m)',
      classe: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
      icone: 'clock-rewind'
    },
    pulado: {
      rotulo: 'Pulado',
      classe: 'bg-rose-500/10 text-rose-400 border border-rose-500/30 line-through opacity-70',
      icone: 'x-circle'
    },
    descanso: {
      rotulo: 'Descanso Ativo',
      classe: 'bg-teal-500/20 text-teal-300 border border-teal-500/40',
      icone: 'coffee'
    }
  };

  function obterDataISO(modo) {
    var d = new Date();
    if (modo === 'amanha') {
      d.setDate(d.getDate() + 1);
    }
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var dia = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + dia;
  }

  var estadoAtual = {
    blocos: [],
    filtroAtivo: 'todos',
    ultimoSync: null,
    modoData: 'hoje',
    dataISO: obterDataISO('hoje')
  };

  function normalizarBloco(raw, idx) {
    var b = raw || {};
    var id = String(b.id || 'bloco-' + idx);
    var titulo = String(b.titulo || b.nome || 'Atividade Programada');
    var inicio = String(b.inicio || b.horario_inicio || (b.horario ? b.horario.split('-')[0] : '') || '08:00').trim();
    var fim = String(b.fim || b.horario_fim || (b.horario ? b.horario.split('-')[1] : '') || '09:00').trim();
    var categoria = (b.categoria || '').toLowerCase();
    if (!CATEGORIA_CONFIG[categoria]) {
      if (/plant[aã]o|enfermaria|uti|leito|sala\s+vermelha|hospital/i.test(titulo)) categoria = 'plantao';
      else if (/medquest|anki|estudo|quest[õo]es|aula/i.test(titulo)) categoria = 'estudo';
      else if (/treino|academia|cardio|muscula/i.test(titulo)) categoria = 'treino';
      else if (/sono|descanso|cochilo|recupera/i.test(titulo)) categoria = 'recuperacao';
      else if (/viol[aã]o|m[uú]sica|guitarra|lazer|leitura|livro|pessoal|hobby|ingl[eê]s|fam[ií]lia|lifestyle|vida/i.test(titulo)) categoria = 'lifestyle';
      else categoria = 'compromisso';
    }

    var status = (b.status || (b.ativo ? 'ativo' : 'pendente')).toLowerCase();
    if (!STATUS_CONFIG[status]) status = 'pendente';

    return {
      id: id,
      titulo: titulo,
      inicio: inicio,
      fim: fim,
      categoria: categoria,
      status: status,
      nota: String(b.nota || b.descricao || ''),
      ativo: Boolean(b.ativo || status === 'ativo')
    };
  }

  function carregarBlocosLocais(dataISO) {
    var alvoData = dataISO || estadoAtual.dataISO || obterDataISO('hoje');
    var chaveData = STORAGE_KEY + '_' + alvoData;
    try {
      var raw = localStorage.getItem(chaveData);
      if (!raw && alvoData === obterDataISO('hoje')) {
        raw = localStorage.getItem(STORAGE_KEY);
      }
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(normalizarBloco);
        }
      }
    } catch (_) {}
    return [];
  }

  function salvarBlocosLocais(blocos, dataISO) {
    var alvoData = dataISO || estadoAtual.dataISO || obterDataISO('hoje');
    var chaveData = STORAGE_KEY + '_' + alvoData;
    try {
      localStorage.setItem(chaveData, JSON.stringify(blocos));
      if (alvoData === obterDataISO('hoje')) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(blocos));
      }
      atualizarBadgeSync('Salvo offline');
    } catch (_) {}
  }

  function atualizarBadgeSync(texto, online) {
    var badge = document.getElementById('rotina-sync-badge');
    if (!badge) return;
    badge.textContent = texto || (online ? 'Sincronizado' : 'Offline');
    if (online) {
      badge.className = 'text-[9.5px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1';
    } else {
      badge.className = 'text-[9.5px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1';
    }
  }

  function renderizarHeaderContadores(blocos) {
    var totalEl = document.getElementById('rotina-contador-total');
    var concluidosEl = document.getElementById('rotina-contador-concluidos');
    var progressoBarra = document.getElementById('rotina-barra-progresso');

    var total = blocos.length;
    var concluidos = blocos.filter(function(b) { return b.status === 'concluido' || b.status === 'descanso'; }).length;
    var pct = total > 0 ? Math.round((concluidos / total) * 100) : 0;

    if (totalEl) totalEl.textContent = String(total);
    if (concluidosEl) concluidosEl.textContent = String(concluidos);
    if (progressoBarra) progressoBarra.style.width = pct + '%';
  }

  function classificarEixoBlocoLocal(bloco) {
    var cat = (bloco && bloco.categoria ? String(bloco.categoria) : "").toLowerCase();
    var tit = (bloco && bloco.titulo ? String(bloco.titulo) : "").toLowerCase();
    if (cat === "estudo" || /medquest|anki|estudo|quest[õo]es|questoes|aula|revis[aã]o|revisao|teoria/i.test(tit)) {
      return "estudo";
    }
    if (cat === "plantao" || cat === "clinico" || /plant[aã]o|plantao|internato|enfermaria|usf|upa|samu|\bue\b|uti|ambulatório|ambulatorio|leito/i.test(tit)) {
      return "plantao";
    }
    if (cat === "treino" || /treino|academia|muscula|cardio|corrida/i.test(tit)) {
      return "treino";
    }
    return "habitos";
  }

  function calcularDuracaoHorasLocal(inicio, fim) {
    if (!inicio || !fim) return 1.0;
    var pI = String(inicio).split(":");
    var pF = String(fim).split(":");
    var mI = parseInt(pI[0], 10) * 60 + parseInt(pI[1] || 0, 10);
    var mF = parseInt(pF[0], 10) * 60 + parseInt(pF[1] || 0, 10);
    var diff = mF - mI;
    if (diff <= 0) diff += 1440;
    return Math.round((diff / 60) * 10) / 10;
  }

  function calcularAderenciaSemanalLocal() {
    var eixos = {
      plantao: { rotulo: "Plantão", planejados: 0, concluidos: 0, horasPlanejadas: 0, horasConcluidas: 0, taxa: 0 },
      estudo: { rotulo: "MedQuest", planejados: 0, concluidos: 0, horasPlanejadas: 0, horasConcluidas: 0, taxa: 0 },
      treino: { rotulo: "Treino", planejados: 0, concluidos: 0, horasPlanejadas: 0, horasConcluidas: 0, taxa: 0 },
      habitos: { rotulo: "Hábitos", planejados: 0, concluidos: 0, horasPlanejadas: 0, horasConcluidas: 0, taxa: 0 }
    };

    var hojeObj = new Date();
    var hojeISO = obterDataISO('hoje');

    for (var i = 6; i >= 0; i--) {
      var d = new Date(hojeObj.getTime() - (i * 86400000));
      var y = d.getFullYear();
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      var dia = ('0' + d.getDate()).slice(-2);
      var dataISO = y + '-' + m + '-' + dia;

      var blocosDoDia = [];
      if (dataISO === hojeISO && estadoAtual.blocos && estadoAtual.blocos.length > 0) {
        blocosDoDia = estadoAtual.blocos;
      } else {
        blocosDoDia = carregarBlocosLocais(dataISO) || [];
      }

      for (var b = 0; b < blocosDoDia.length; b++) {
        var bloco = blocosDoDia[b];
        var eixoKey = classificarEixoBlocoLocal(bloco);
        var dur = calcularDuracaoHorasLocal(bloco.inicio, bloco.fim);

        eixos[eixoKey].planejados++;
        eixos[eixoKey].horasPlanejadas = Math.round((eixos[eixoKey].horasPlanejadas + dur) * 10) / 10;

        if (bloco.status === 'concluido') {
          eixos[eixoKey].concluidos++;
          eixos[eixoKey].horasConcluidas = Math.round((eixos[eixoKey].horasConcluidas + dur) * 10) / 10;
        }
      }
    }

    var totalPlanejados = 0;
    var totalConcluidos = 0;
    var keys = ["plantao", "estudo", "treino", "habitos"];

    for (var k = 0; k < keys.length; k++) {
      var kName = keys[k];
      var p = eixos[kName].planejados;
      var c = eixos[kName].concluidos;
      totalPlanejados += p;
      totalConcluidos += c;
      // Previne divisão por zero (0/0 -> 0%)
      eixos[kName].taxa = p > 0 ? Math.round((c / p) * 100) : 0;
    }

    var taxaGlobal = totalPlanejados > 0 ? Math.round((totalConcluidos / totalPlanejados) * 100) : 0;

    return {
      taxaGlobal: taxaGlobal,
      totalPlanejados: totalPlanejados,
      totalConcluidos: totalConcluidos,
      horasEstudoConcluidas: eixos.estudo.horasConcluidas,
      horasPlantaoConcluidas: eixos.plantao.horasConcluidas,
      eixos: eixos
    };
  }

  function atualizarPainelAderencia(dados) {
    var ad = dados || calcularAderenciaSemanalLocal();
    if (!ad) return;

    var pctSemanalEl = document.getElementById('aderencia-pct-semanal');
    var pctValorEl = document.getElementById('aderencia-pct-valor');
    var blocosDetalheEl = document.getElementById('aderencia-blocos-detalhe');
    var horasEstudoEl = document.getElementById('aderencia-horas-estudo');
    var horasPlantaoEl = document.getElementById('aderencia-horas-plantao');
    var barraProgressoEl = document.getElementById('aderencia-barra-progresso');

    if (pctSemanalEl) pctSemanalEl.textContent = String(ad.taxaGlobal);
    if (pctValorEl) pctValorEl.textContent = String(ad.taxaGlobal) + '%';
    if (blocosDetalheEl) blocosDetalheEl.textContent = ad.totalConcluidos + ' de ' + ad.totalPlanejados + ' blocos';
    if (horasEstudoEl) horasEstudoEl.textContent = (ad.horasEstudoConcluidas || 0).toFixed(1) + 'h';
    if (horasPlantaoEl) horasPlantaoEl.textContent = (ad.horasPlantaoConcluidas || 0).toFixed(1) + 'h';
    if (barraProgressoEl) barraProgressoEl.style.width = ad.taxaGlobal + '%';

    // Mini-barras por eixo
    if (ad.eixos) {
      var mapEixos = [
        { id: 'plantao', val: 'aderencia-eixo-plantao-val', bar: 'aderencia-eixo-plantao-bar' },
        { id: 'estudo', val: 'aderencia-eixo-estudo-val', bar: 'aderencia-eixo-estudo-bar' },
        { id: 'treino', val: 'aderencia-eixo-treino-val', bar: 'aderencia-eixo-treino-bar' },
        { id: 'habitos', val: 'aderencia-eixo-habitos-val', bar: 'aderencia-eixo-habitos-bar' }
      ];
      for (var i = 0; i < mapEixos.length; i++) {
        var item = mapEixos[i];
        var info = ad.eixos[item.id] || { taxa: 0 };
        var valEl = document.getElementById(item.val);
        var barEl = document.getElementById(item.bar);
        if (valEl) valEl.textContent = info.taxa + '%';
        if (barEl) barEl.style.width = info.taxa + '%';
      }
    }
  }

  function converterHoraEmMinutos(horaStr) {
    if (!horaStr || typeof horaStr !== 'string') return -1;
    var partes = horaStr.split(':');
    if (partes.length < 2) return -1;
    var h = parseInt(partes[0], 10);
    var m = parseInt(partes[1], 10);
    if (isNaN(h) || isNaN(m)) return -1;
    return h * 60 + m;
  }

  function formatarMinutosEmHora(minutosTotais) {
    var minNorm = ((minutosTotais % 1440) + 1440) % 1440;
    var h = Math.floor(minNorm / 60);
    var m = minNorm % 60;
    return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
  }

  function calcularEstadoTempoBloco(bloco) {
    var agora = new Date();
    var minAgora = agora.getHours() * 60 + agora.getMinutes();
    var minIni = converterHoraEmMinutos(bloco.inicio);
    var minFim = converterHoraEmMinutos(bloco.fim);
    if (minIni < 0 || minFim < 0) return { emAndamento: false, rotulo: '' };

    if (minAgora >= minIni && minAgora <= minFim) {
      var restantes = minFim - minAgora;
      return {
        emAndamento: true,
        rotulo: restantes <= 1 ? 'Terminando agora' : 'Restam ' + restantes + 'm'
      };
    }
    if (minAgora < minIni && (minIni - minAgora) <= 30) {
      return {
        emAndamento: false,
        rotulo: 'Inicia em ' + (minIni - minAgora) + 'm'
      };
    }
    return { emAndamento: false, rotulo: '' };
  }

  function criarCardBloco(bloco) {
    var catCfg = CATEGORIA_CONFIG[bloco.categoria] || CATEGORIA_CONFIG.compromisso;
    var stCfg = STATUS_CONFIG[bloco.status] || STATUS_CONFIG.pendente;
    var tempoInfo = calcularEstadoTempoBloco(bloco);
    var ehAtivoAgora = tempoInfo.emAndamento && bloco.status !== 'concluido' && bloco.status !== 'pulado';
    var ehConcluido = bloco.status === 'concluido';
    var ehPulado = bloco.status === 'pulado';

    var card = document.createElement('div');
    card.id = 'card-' + bloco.id;
    card.className = 'glass-card p-3.5 rounded-2xl transition duration-150 space-y-2.5 ' +
                     catCfg.borda + ' ' +
                     (ehAtivoAgora
                       ? 'ring-1.5 ring-brand-400 bg-slate-900/95 shadow-lg shadow-brand-500/10'
                       : (ehConcluido
                           ? 'bg-slate-950/60 border border-slate-800/60 opacity-80'
                           : (ehPulado
                               ? 'bg-slate-950/50 border border-slate-800/40 opacity-60'
                               : (bloco.status === 'ativo'
                                   ? 'ring-1 ring-brand-400/50 bg-slate-900/90'
                                   : 'bg-slate-900/70 hover:bg-slate-900/90 border border-slate-800/80'))));

    // Linha 1: Horário, Categoria e Badge de Status
    var topo = document.createElement('div');
    topo.className = 'flex items-center justify-between gap-2';

    var faixaHoraria = document.createElement('div');
    faixaHoraria.className = 'flex items-center gap-2 flex-wrap';

    var iconeCat = document.createElement('i');
    iconeCat.setAttribute('data-lucide', catCfg.icone);
    iconeCat.className = 'w-3.5 h-3.5 ' + (ehAtivoAgora ? 'text-brand-400' : 'text-slate-400');

    var horaTexto = document.createElement('span');
    horaTexto.className = 'font-mono text-xs sm:text-[13px] font-bold text-white tracking-tight';
    horaTexto.textContent = bloco.inicio + (bloco.fim ? ' - ' + bloco.fim : '');

    var catBadge = document.createElement('span');
    catBadge.className = 'text-[9.5px] px-2 py-0.5 rounded-md font-semibold border ' + catCfg.badgeCor;
    catBadge.textContent = catCfg.rotulo;

    faixaHoraria.append(iconeCat, horaTexto, catBadge);

    if (ehAtivoAgora) {
      var liveBadge = document.createElement('span');
      liveBadge.className = 'text-[9.5px] px-2 py-0.5 rounded-md font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1.5';
      liveBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span> AGORA' + (tempoInfo.rotulo ? ' · ' + tempoInfo.rotulo : '');
      faixaHoraria.append(liveBadge);
    } else if (tempoInfo.rotulo && bloco.status === 'pendente') {
      var proxBadge = document.createElement('span');
      proxBadge.className = 'text-[9px] px-1.5 py-0.5 rounded-md font-medium bg-slate-800/90 text-slate-300 border border-slate-700/80';
      proxBadge.textContent = '⏱️ ' + tempoInfo.rotulo;
      faixaHoraria.append(proxBadge);
    }

    var statusBadge = document.createElement('span');
    statusBadge.className = 'text-[9.5px] px-2 py-0.5 rounded-full font-bold ' + stCfg.classe;
    statusBadge.textContent = stCfg.rotulo;

    topo.append(faixaHoraria, statusBadge);
    card.append(topo);

    // Linha 2: Título e Notas/Instruções
    var corpo = document.createElement('div');
    corpo.className = 'space-y-1';

    var tituloEl = document.createElement('h4');
    tituloEl.className = 'text-xs sm:text-sm font-bold ' + (ehConcluido ? 'text-slate-300 line-through' : 'text-white') + ' flex items-center gap-1.5';
    tituloEl.textContent = bloco.titulo;
    corpo.append(tituloEl);

    if (bloco.nota) {
      var notaEl = document.createElement('p');
      notaEl.className = 'text-[11px] sm:text-xs text-slate-300/90 font-normal leading-relaxed pl-2 py-1 rounded bg-slate-950/40 border-l-2 border-slate-700/80';
      notaEl.textContent = bloco.nota;
      corpo.append(notaEl);
    }
    card.append(corpo);

    // Linha 3: Barra de Ações Rápidas em 1 Toque (Alvos táteis confortáveis ≥ 34px)
    var acoes = document.createElement('div');
    acoes.className = 'flex items-center justify-end gap-2 pt-1.5 border-t border-slate-800/80 text-xs font-semibold';

    if (bloco.status !== 'concluido') {
      var btnConcluir = document.createElement('button');
      btnConcluir.type = 'button';
      btnConcluir.className = 'min-h-[34px] px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition active:scale-95 flex items-center gap-1.5 shadow-sm';
      btnConcluir.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Concluir';
      btnConcluir.onclick = function() { RotinaTimeline.alterarStatus(bloco.id, 'concluido'); };
      acoes.append(btnConcluir);
    }

    if (bloco.status !== 'adiado' && bloco.status !== 'concluido') {
      var btnAdiar = document.createElement('button');
      btnAdiar.type = 'button';
      btnAdiar.className = 'min-h-[34px] px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition active:scale-95 flex items-center gap-1.5 shadow-sm';
      btnAdiar.innerHTML = '<i data-lucide="clock" class="w-3.5 h-3.5"></i> Adiar (+30m)';
      btnAdiar.onclick = function() { RotinaTimeline.adiarBloco(bloco.id, 30); };
      acoes.append(btnAdiar);
    }

    if (bloco.status !== 'pulado' && bloco.status !== 'concluido') {
      var btnPular = document.createElement('button');
      btnPular.type = 'button';
      btnPular.className = 'min-h-[34px] px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition active:scale-95 flex items-center gap-1';
      btnPular.innerHTML = '<i data-lucide="x" class="w-3.5 h-3.5"></i> Pular';
      btnPular.onclick = function() { RotinaTimeline.alterarStatus(bloco.id, 'pulado'); };
      acoes.append(btnPular);
    }

    if (bloco.status === 'concluido' || bloco.status === 'pulado') {
      var btnReabrir = document.createElement('button');
      btnReabrir.type = 'button';
      btnReabrir.className = 'min-h-[34px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition active:scale-95 flex items-center gap-1.5 shadow-sm';
      btnReabrir.innerHTML = '<i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Reabrir Bloco';
      btnReabrir.onclick = function() { RotinaTimeline.alterarStatus(bloco.id, 'pendente'); };
      acoes.append(btnReabrir);
    }

    card.append(acoes);
    return card;
  }

  function renderizarEmptyState(container) {
    var ehAmanha = estadoAtual.modoData === 'amanha';
    var box = document.createElement('div');
    box.className = 'glass-card p-6 rounded-2xl text-center space-y-3 border border-slate-800 bg-slate-900/40';

    var iconeWrap = document.createElement('div');
    iconeWrap.className = 'w-10 h-10 mx-auto rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center';
    iconeWrap.innerHTML = '<i data-lucide="calendar" class="w-5 h-5"></i>';

    var tit = document.createElement('h4');
    tit.className = 'text-xs sm:text-sm font-bold text-white';
    tit.textContent = ehAmanha ? 'Nenhum compromisso agendado para amanhã' : 'Nenhum compromisso agendado para hoje';

    var desc = document.createElement('p');
    desc.className = 'text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed';
    desc.textContent = 'Seus eventos e sessões de estudo da Agenda Google (moraes.wagg@gmail.com) são sincronizados em tempo real.';

    var acoes = document.createElement('div');
    acoes.className = 'flex items-center justify-center gap-2 pt-2';

    var btnSync = document.createElement('button');
    btnSync.type = 'button';
    btnSync.className = 'px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold hover:bg-emerald-500/30 transition flex items-center gap-1.5';
    btnSync.innerHTML = '<i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Sincronizar Google Calendar';
    btnSync.onclick = function() { RotinaTimeline.sincronizarAgendaGoogle(); };

    acoes.append(btnSync);
    box.append(iconeWrap, tit, desc, acoes);
    container.append(box);
  }

  function renderizar(blocosEntrada, containerId) {
    var cId = containerId || 'rotina-blocos-container';
    var container = document.getElementById(cId);
    if (!container) return;

    var lista = Array.isArray(blocosEntrada)
      ? blocosEntrada.map(normalizarBloco)
      : carregarBlocosLocais(estadoAtual.dataISO);

    estadoAtual.blocos = lista;
    renderizarHeaderContadores(lista);
    atualizarPainelAderencia();

    var filtrados = lista.filter(function(b) {
      if (estadoAtual.filtroAtivo === 'todos') return true;
      return b.categoria === estadoAtual.filtroAtivo;
    });

    container.replaceChildren();

    if (filtrados.length === 0) {
      renderizarEmptyState(container);
    } else {
      filtrados.forEach(function(bloco) {
        container.append(criarCardBloco(bloco));
      });
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons({ root: container });
      } catch (_) {}
    }
  }

  function alterarStatus(blocoId, novoStatus, nota) {
    var bloco = null;
    for (var i = 0; i < estadoAtual.blocos.length; i++) {
      if (estadoAtual.blocos[i].id === blocoId) {
        estadoAtual.blocos[i].status = novoStatus;
        if (nota) estadoAtual.blocos[i].nota = nota;
        bloco = estadoAtual.blocos[i];
        break;
      }
    }
    if (!bloco) return;

    salvarBlocosLocais(estadoAtual.blocos);
    renderizar(estadoAtual.blocos);

    // Tenta persistir no backend Fastify de forma resiliente
    sincronizarStatusComBackend(blocoId, novoStatus, nota);
  }

  function ativarModoDescanso() {
    var alterado = false;
    for (var i = 0; i < estadoAtual.blocos.length; i++) {
      var cat = estadoAtual.blocos[i].categoria;
      if (cat === 'treino' || cat === 'estudo') {
        estadoAtual.blocos[i].status = 'descanso';
        estadoAtual.blocos[i].nota = 'Descanso biológico e recuperação ativados pelo Dr. Wagner';
        alterado = true;
      }
    }
    if (alterado) {
      salvarBlocosLocais(estadoAtual.blocos);
      renderizar(estadoAtual.blocos);
      if (typeof window.copiarToast === 'function') {
        window.copiarToast('🌿 Modo Descanso ativado para os blocos de treino e estudo!');
      }
    }
  }

  function aplicarFiltro(categoria) {
    estadoAtual.filtroAtivo = categoria || 'todos';

    // Atualiza classes visuais dos botões de filtro
    var botoes = document.querySelectorAll('.btn-filtro-rotina');
    botoes.forEach(function(btn) {
      var cat = btn.getAttribute('data-filtro') || 'todos';
      if (cat === estadoAtual.filtroAtivo) {
        btn.className = 'btn-filtro-rotina min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-500/20 text-brand-300 border border-brand-500/40 transition active:scale-95 shadow-sm';
      } else {
        btn.className = 'btn-filtro-rotina min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:text-white transition active:scale-95';
      }
    });

    renderizar(estadoAtual.blocos);
  }

  function carregarGradePadrao() {
    var hoje = new Date();
    var diaSem = hoje.getDay(); // 0 dom, 6 sab
    var ehFimDeSemana = (diaSem === 0 || diaSem === 6);

    var gradePadrao = [
      {
        id: 'bloco-manha',
        titulo: ehFimDeSemana ? 'Estudos Ativos MedQuest R1' : 'Plantão & Rodízio Hospitalar',
        inicio: '07:00',
        fim: '13:00',
        categoria: ehFimDeSemana ? 'estudo' : 'plantao',
        status: 'pendente',
        nota: ehFimDeSemana ? 'Bloco 1: 30 questões comentadas no MedQuest' : 'Enfermaria Geral · Passagem de Plantão SBAR'
      },
      {
        id: 'bloco-tarde',
        titulo: 'Ambulatório & Condutas Específicas',
        inicio: '13:30',
        fim: '17:30',
        categoria: 'plantao',
        status: 'pendente',
        nota: 'Atendimento clínico com registro ágil via /soap e /rx'
      },
      {
        id: 'bloco-treino',
        titulo: 'Treino Musculação & Cardio',
        inicio: '18:00',
        fim: '19:15',
        categoria: 'treino',
        status: 'pendente',
        nota: 'Protocolo Cutting Natural + Shake Pós-Treino'
      },
      {
        id: 'bloco-noite',
        titulo: 'MedQuest & Revisão de Flashcards Anki',
        inicio: '20:30',
        fim: '22:30',
        categoria: 'estudo',
        status: 'pendente',
        nota: 'Foco da semana: Casos clínicos de alto rendimento'
      }
    ];

    salvarBlocosLocais(gradePadrao);
    renderizar(gradePadrao);
    if (typeof window.copiarToast === 'function') {
      window.copiarToast('✨ Grade diária padrão carregada com sucesso!');
    }
  }

  function carregarGradePadraoComConfirmacao() {
    var confirmou = false;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      confirmou = window.confirm('Deseja realmente carregar a grade diária padrão fixa?\n\nIsso irá substituir os blocos do dia atual no Cockpit.');
    } else {
      confirmou = true;
    }
    if (confirmou) {
      carregarGradePadrao();
    }
  }

  var QUEUE_KEY = 'rotina_fila_mutacoes_v1';
  var filaProcessando = false;

  function obterFilaOffline() {
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  function obterStatusFilaOffline() {
    var fila = obterFilaOffline();
    return {
      pendencias: fila.length,
      processando: filaProcessando || false
    };
  }

  function salvarBlocosOfflineAsync(blocos, dataISO) {
    return new Promise(function(resolve) {
      salvarBlocosLocais(blocos, dataISO);
      var alvoData = dataISO || estadoAtual.dataISO || obterDataISO('hoje');
      var chaveData = STORAGE_KEY + '_' + alvoData;

      if (typeof window !== 'undefined' && window.localDb && typeof window.localDb.table === 'function') {
        try {
          window.localDb.table('snapshots').put({
            chave: chaveData,
            payload: JSON.stringify(blocos),
            atualizadoEm: Date.now()
          }).then(function() {
            resolve(true);
          }).catch(function() {
            resolve(true);
          });
          return;
        } catch (_) {}
      }
      resolve(true);
    });
  }

  function carregarBlocosOfflineAsync(dataISO) {
    return new Promise(function(resolve) {
      var alvoData = dataISO || estadoAtual.dataISO || obterDataISO('hoje');
      var chaveData = STORAGE_KEY + '_' + alvoData;

      if (typeof window !== 'undefined' && window.localDb && typeof window.localDb.table === 'function') {
        try {
          window.localDb.table('snapshots').get(chaveData).then(function(item) {
            if (item && item.payload) {
              var parsed = JSON.parse(item.payload);
              if (Array.isArray(parsed) && parsed.length > 0) {
                return resolve(parsed.map(normalizarBloco));
              }
            }
            resolve(carregarBlocosLocais(alvoData));
          }).catch(function() {
            resolve(carregarBlocosLocais(alvoData));
          });
          return;
        } catch (_) {}
      }
      resolve(carregarBlocosLocais(alvoData));
    });
  }

  function enfileirarMutacaoOffline(blocoId, status, nota) {
    try {
      var fila = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      fila.push({
        blocoId: blocoId,
        status: status,
        nota: nota || '',
        timestamp: Date.now()
      });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(fila));
      atualizarBadgeSync('Salvo offline (' + fila.length + ' pendente' + (fila.length > 1 ? 's' : '') + ')', false);

      if (typeof window !== 'undefined' && window.localDb && typeof window.localDb.table === 'function') {
        try {
          window.localDb.table('syncQueue').add({
            acao: 'rotina_status',
            payload: JSON.stringify({ blocoId: blocoId, status: status, nota: nota }),
            status: 'pendente',
            criadoEm: Date.now()
          }).catch(function() {});
        } catch (_) {}
      }
    } catch (_) {}
  }

  function processarFilaOffline() {
    if (!navigator.onLine || filaProcessando) return;
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return;
      var fila = JSON.parse(raw);
      if (!Array.isArray(fila) || fila.length === 0) return;

      filaProcessando = true;
      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/status';
      var item = fila[0];

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      }).then(function(res) {
        filaProcessando = false;
        if (res.ok) {
          var filaAtual = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
          filaAtual.shift();
          localStorage.setItem(QUEUE_KEY, JSON.stringify(filaAtual));
          if (filaAtual.length > 0) {
            processarFilaOffline();
          } else {
            atualizarBadgeSync('Sincronizado', true);
          }
        }
      }).catch(function() {
        filaProcessando = false;
      });
    } catch (_) {
      filaProcessando = false;
    }
  }

  function adiarBloco(blocoId, minutos) {
    var minAdd = minutos || 30;
    var blocoModificado = null;
    for (var i = 0; i < estadoAtual.blocos.length; i++) {
      var b = estadoAtual.blocos[i];
      if (b.id === blocoId) {
        var minIni = converterHoraEmMinutos(b.inicio);
        var minFim = converterHoraEmMinutos(b.fim);
        if (minIni >= 0) {
          b.inicio = formatarMinutosEmHora(minIni + minAdd);
        }
        if (minFim >= 0) {
          b.fim = formatarMinutosEmHora(minFim + minAdd);
        }
        b.status = 'adiado';
        b.nota = (b.nota ? b.nota + ' · ' : '') + 'Adiado em ' + minAdd + 'm';
        blocoModificado = b;
        break;
      }
    }
    if (blocoModificado) {
      salvarBlocosLocais(estadoAtual.blocos);
      renderizar(estadoAtual.blocos);
      sincronizarStatusComBackend(blocoModificado.id, 'adiado', blocoModificado.nota);
      if (typeof window.copiarToast === 'function') {
        window.copiarToast('⏰ Bloco adiado para ' + blocoModificado.inicio + ' - ' + blocoModificado.fim);
      }
    }
  }

  function sincronizarStatusComBackend(blocoId, status, nota) {
    if (!navigator.onLine) {
      enfileirarMutacaoOffline(blocoId, status, nota);
      return;
    }
    try {
      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/status';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocoId: blocoId, status: status, nota: nota })
      }).then(function(res) {
        if (res.ok) {
          atualizarBadgeSync('Sincronizado', true);
          processarFilaOffline();
        } else {
          enfileirarMutacaoOffline(blocoId, status, nota);
        }
      }).catch(function() {
        enfileirarMutacaoOffline(blocoId, status, nota);
      });
    } catch (_) {
      enfileirarMutacaoOffline(blocoId, status, nota);
    }
  }

  function alternarData(modo) {
    var novoModo = (modo === 'amanha') ? 'amanha' : 'hoje';
    estadoAtual.modoData = novoModo;
    estadoAtual.dataISO = obterDataISO(novoModo);

    var btnHoje = document.getElementById('btn-rotina-data-hoje');
    var btnAmanha = document.getElementById('btn-rotina-data-amanha');
    var labelProgresso = document.getElementById('rotina-label-progresso');

    if (btnHoje && btnAmanha) {
      if (novoModo === 'hoje') {
        btnHoje.className = 'py-1.5 px-3 rounded-lg font-bold bg-brand-500/20 text-brand-300 border border-brand-500/40 transition flex items-center justify-center gap-1.5';
        btnAmanha.className = 'py-1.5 px-3 rounded-lg font-medium bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200 transition flex items-center justify-center gap-1.5';
      } else {
        btnAmanha.className = 'py-1.5 px-3 rounded-lg font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 transition flex items-center justify-center gap-1.5';
        btnHoje.className = 'py-1.5 px-3 rounded-lg font-medium bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200 transition flex items-center justify-center gap-1.5';
      }
    }

    if (labelProgresso) {
      labelProgresso.textContent = novoModo === 'hoje' ? 'Progresso dos Blocos de Hoje' : 'Compromissos e Estudos de Amanhã';
    }

    // Renderiza blocos locais salvos para feedback imediato (0ms)
    var blocosLocais = carregarBlocosLocais(estadoAtual.dataISO);
    renderizar(blocosLocais);

    // Atualiza com dados frescos do Google Calendar
    carregarBlocosDoServidor(estadoAtual.dataISO);
  }

  function carregarBlocosDoServidor(dataISO, callback) {
    if (typeof dataISO === 'function') {
      callback = dataISO;
      dataISO = null;
    }
    var targetDateISO = dataISO || estadoAtual.dataISO || obterDataISO('hoje');
    estadoAtual.dataISO = targetDateISO;

    if (!navigator.onLine) {
      if (typeof callback === 'function') callback(null);
      return;
    }
    try {
      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/blocos?data=' + encodeURIComponent(targetDateISO);
      fetch(endpoint).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && Array.isArray(data.blocos)) {
          salvarBlocosLocais(data.blocos, targetDateISO);
          renderizar(data.blocos);
          atualizarBadgeSync('Google Calendar', true);
        }
        processarFilaOffline();
        if (typeof callback === 'function') callback(data);
      }).catch(function(err) {
        console.warn('[RotinaTimeline] Erro ao carregar blocos do servidor:', err);
        if (typeof callback === 'function') callback(null);
      });
    } catch (e) {
      if (typeof callback === 'function') callback(null);
    }
  }

  function sincronizarAgendaGoogle(callback) {
    var targetDateISO = estadoAtual.dataISO || obterDataISO('hoje');
    atualizarBadgeSync('Sincronizando...', false);
    if (!navigator.onLine) {
      atualizarBadgeSync('Offline', false);
      if (typeof window.copiarToast === 'function') {
        window.copiarToast('⚠️ Sem conexão para sincronizar com Google Calendar.');
      }
      if (typeof callback === 'function') callback(null);
      return;
    }

    try {
      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/agenda/sync';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: targetDateISO })
      }).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && Array.isArray(data.blocos)) {
          salvarBlocosLocais(data.blocos, targetDateISO);
          renderizar(data.blocos);
          atualizarBadgeSync('Google Calendar', true);
          if (typeof window.copiarToast === 'function') {
            window.copiarToast('📅 Sincronizado com o Google Calendar do Dr. Wagner (' + data.blocos.length + ' blocos)!');
          }
        }
        processarFilaOffline();
        if (typeof callback === 'function') callback(data);
      }).catch(function(err) {
        console.warn('[RotinaTimeline] Falha na sincronização da agenda:', err);
        atualizarBadgeSync('Salvo offline', false);
        if (typeof window.copiarToast === 'function') {
          window.copiarToast('⚠️ Erro ao sincronizar com Google Calendar: ' + err.message);
        }
        if (typeof callback === 'function') callback(null);
      });
    } catch (e) {
      atualizarBadgeSync('Salvo offline', false);
      if (typeof callback === 'function') callback(null);
    }
  }

  // ==========================================
  // Gaveta de Dúvidas MedQuest & Residência
  // ==========================================

  function carregarDuvidasLocais() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_DUVIDAS);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  }

  function salvarDuvidasLocais(duvidas) {
    try {
      localStorage.setItem(STORAGE_KEY_DUVIDAS, JSON.stringify(duvidas || []));
    } catch (_) {}
  }

  function renderizarDuvidas(duvidasEntrada) {
    var container = document.getElementById('rotina-duvidas-lista');
    var badgeContador = document.getElementById('duvidas-contador-badge');
    var duvidas = Array.isArray(duvidasEntrada) ? duvidasEntrada : carregarDuvidasLocais();

    var pendentes = duvidas.filter(function(d) { return !d.resolvida; });
    if (badgeContador) {
      badgeContador.textContent = String(pendentes.length);
      if (pendentes.length > 0) {
        badgeContador.className = 'text-[9.5px] px-1.5 py-0.2 rounded-full font-bold bg-purple-500/30 text-purple-200 border border-purple-500/40';
      } else {
        badgeContador.className = 'text-[9.5px] px-1.5 py-0.2 rounded-full font-bold bg-slate-800 text-slate-400 border border-slate-700';
      }
    }

    if (!container) return;
    container.replaceChildren();

    if (duvidas.length === 0) {
      var vazio = document.createElement('div');
      vazio.className = 'text-[11px] text-slate-400 text-center py-2.5 italic';
      vazio.textContent = 'Nenhuma dúvida anotada. Registre temas de questões ou plantão para revisar!';
      container.append(vazio);
      return;
    }

    duvidas.forEach(function(item) {
      var row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 p-2 rounded-xl transition ' +
        (item.resolvida
          ? 'bg-slate-900/40 border border-slate-800 text-slate-500'
          : 'bg-slate-900/80 border border-purple-500/20 text-slate-200 hover:border-purple-500/40');

      var corpo = document.createElement('div');
      corpo.className = 'flex-1 min-w-0 flex items-start gap-2';

      var bullet = document.createElement('span');
      bullet.className = 'mt-1 w-1.5 h-1.5 rounded-full shrink-0 ' + (item.resolvida ? 'bg-slate-600' : 'bg-purple-400');

      var texto = document.createElement('p');
      texto.className = 'text-[11.5px] leading-tight break-words ' + (item.resolvida ? 'line-through text-slate-500' : 'text-slate-100 font-medium');
      texto.textContent = item.texto || item.duvida || 'Sem texto';

      corpo.append(bullet, texto);

      var btnCheck = document.createElement('button');
      btnCheck.type = 'button';
      btnCheck.className = 'min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 transition active:scale-95 flex items-center gap-1.5 shadow-sm ' +
        (item.resolvida
          ? 'bg-slate-800 text-slate-400 hover:text-slate-300 border border-slate-700/60'
          : 'bg-purple-500/20 hover:bg-emerald-500/20 text-purple-200 hover:text-emerald-300 border border-purple-500/35 hover:border-emerald-500/40');
      btnCheck.innerHTML = item.resolvida
        ? '<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i> Revisada'
        : '<i data-lucide="check" class="w-3.5 h-3.5"></i> Concluir';

      btnCheck.onclick = function(e) {
        e.stopPropagation();
        resolverDuvidaCockpit(item.id);
      };

      row.append(corpo, btnCheck);
      container.append(row);
    });

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons({ root: container });
      } catch (_) {}
    }
  }

  function carregarDuvidasDoServidor(callback) {
    if (!navigator.onLine) {
      var locais = carregarDuvidasLocais();
      renderizarDuvidas(locais);
      if (typeof callback === 'function') callback(locais);
      return;
    }
    try {
      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/duvidas';
      fetch(endpoint).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && Array.isArray(data.duvidas)) {
          salvarDuvidasLocais(data.duvidas);
          renderizarDuvidas(data.duvidas);
        }
        if (typeof callback === 'function') callback(data);
      }).catch(function(err) {
        console.warn('[RotinaTimeline] Erro ao buscar dúvidas do servidor:', err);
        var locais = carregarDuvidasLocais();
        renderizarDuvidas(locais);
        if (typeof callback === 'function') callback(null);
      });
    } catch (_) {
      if (typeof callback === 'function') callback(null);
    }
  }

  function adicionarDuvidaCockpit() {
    var input = document.getElementById('input-nova-duvida-cockpit');
    if (!input) return;
    var texto = (input.value || '').trim();
    if (!texto) return;

    input.value = '';

    var tempId = 'duv_' + Date.now();
    var novaDuvida = {
      id: tempId,
      texto: texto,
      resolvida: false,
      origem: 'cockpit',
      dataCriacao: new Date().toISOString()
    };

    var lista = carregarDuvidasLocais();
    lista.unshift(novaDuvida);
    salvarDuvidasLocais(lista);
    renderizarDuvidas(lista);

    if (typeof window.copiarToast === 'function') {
      window.copiarToast('💡 Dúvida anotada! Disponível no Cockpit e no Telegram.');
    }

    if (!navigator.onLine) return;

    try {
      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/duvidas';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: texto, origem: 'cockpit' })
      }).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && data.duvida) {
          var atualizadas = carregarDuvidasLocais();
          for (var i = 0; i < atualizadas.length; i++) {
            if (atualizadas[i].id === tempId) {
              atualizadas[i] = data.duvida;
              break;
            }
          }
          salvarDuvidasLocais(atualizadas);
          renderizarDuvidas(atualizadas);
        }
      }).catch(function(err) {
        console.warn('[RotinaTimeline] Erro ao sincronizar nova dúvida com servidor:', err);
      });
    } catch (_) {}
  }

  function resolverDuvidaCockpit(id) {
    if (!id) return;
    var lista = carregarDuvidasLocais();
    var encontrada = null;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        lista[i].resolvida = !lista[i].resolvida;
        encontrada = lista[i];
        break;
      }
    }
    salvarDuvidasLocais(lista);
    renderizarDuvidas(lista);

    if (encontrada && encontrada.resolvida && typeof window.copiarToast === 'function') {
      window.copiarToast('✅ Dúvida marcada como revisada!');
    }

    if (!navigator.onLine) return;

    try {
      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/duvidas/resolver';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      }).catch(function(err) {
        console.warn('[RotinaTimeline] Erro ao sincronizar resolução no servidor:', err);
      });
    } catch (_) {}
  }

  function alternarGavetaDuvidas() {
    var conteudo = document.getElementById('rotina-duvidas-conteudo');
    var icone = document.getElementById('icone-toggle-duvidas');
    if (!conteudo) return;

    var estaOculto = conteudo.classList.contains('hidden');
    if (estaOculto) {
      conteudo.classList.remove('hidden');
      if (icone) icone.style.transform = 'rotate(0deg)';
    } else {
      conteudo.classList.add('hidden');
      if (icone) icone.style.transform = 'rotate(-90deg)';
    }
  }

  // ==========================================
  // Auto-Sincronização em Tempo Real (Polling Suave)
  // ==========================================

  var POLLING_INTERVALO_MS = 30000;
  var timerPolling = null;

  function iniciarPollingSuave() {
    if (typeof setInterval !== 'function') return;
    if (timerPolling) return;

    timerPolling = setInterval(function() {
      try {
        if (!navigator.onLine) return;
        if (typeof document !== 'undefined') {
          if (document.hidden) return;
          var tabRotina = document.getElementById('tab-rotina');
          if (tabRotina && tabRotina.classList.contains('hidden')) return;
        }

        carregarBlocosDoServidor(estadoAtual.dataISO);
        carregarDuvidasDoServidor();
      } catch (_) {}
    }, POLLING_INTERVALO_MS);
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', function() {
      processarFilaOffline();
      carregarBlocosDoServidor();
      carregarDuvidasDoServidor();
    });
  }

  // Exportação Pública do Módulo
  window.RotinaTimeline = {
    renderizar: renderizar,
    alternarData: alternarData,
    obterDataISO: obterDataISO,
    alterarStatus: alterarStatus,
    adiarBloco: adiarBloco,
    ativarModoDescanso: ativarModoDescanso,
    aplicarFiltro: aplicarFiltro,
    carregarGradePadrao: carregarGradePadrao,
    carregarGradePadraoComConfirmacao: carregarGradePadraoComConfirmacao,
    carregarBlocosLocais: carregarBlocosLocais,
    salvarBlocosLocais: salvarBlocosLocais,
    carregarBlocosDoServidor: carregarBlocosDoServidor,
    sincronizarAgendaGoogle: sincronizarAgendaGoogle,
    processarFilaOffline: processarFilaOffline,
    converterHoraEmMinutos: converterHoraEmMinutos,
    formatarMinutosEmHora: formatarMinutosEmHora,
    calcularEstadoTempoBloco: calcularEstadoTempoBloco,
    normalizarBloco: normalizarBloco,
    carregarDuvidasLocais: carregarDuvidasLocais,
    salvarDuvidasLocais: salvarDuvidasLocais,
    renderizarDuvidas: renderizarDuvidas,
    carregarDuvidasDoServidor: carregarDuvidasDoServidor,
    adicionarDuvidaCockpit: adicionarDuvidaCockpit,
    resolverDuvidaCockpit: resolverDuvidaCockpit,
    alternarGavetaDuvidas: alternarGavetaDuvidas,
    iniciarPollingSuave: iniciarPollingSuave,
    salvarBlocosOfflineAsync: salvarBlocosOfflineAsync,
    carregarBlocosOfflineAsync: carregarBlocosOfflineAsync,
    obterFilaOffline: obterFilaOffline,
    obterStatusFilaOffline: obterStatusFilaOffline,
    enfileirarMutacaoOffline: enfileirarMutacaoOffline,
    calcularAderenciaSemanalLocal: calcularAderenciaSemanalLocal,
    atualizarPainelAderencia: atualizarPainelAderencia,
    CATEGORIA_CONFIG: CATEGORIA_CONFIG,
    STATUS_CONFIG: STATUS_CONFIG
  };

  // Carrega automaticamente em segundo plano ao inicializar
  if (typeof window !== 'undefined' && typeof setTimeout === 'function') {
    setTimeout(function() {
      try {
        var blocosCache = carregarBlocosLocais();
        if (blocosCache.length > 0) renderizar(blocosCache);
        carregarBlocosDoServidor();

        var duvidasCache = carregarDuvidasLocais();
        if (duvidasCache.length > 0) renderizarDuvidas(duvidasCache);
        carregarDuvidasDoServidor();

        iniciarPollingSuave();
      } catch (_) {}
    }, 100);
  }

})(typeof window !== 'undefined' ? window : this);
