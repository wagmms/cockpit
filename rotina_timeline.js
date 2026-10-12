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

  var CATEGORIA_CONFIG = {
    plantao: {
      rotulo: 'Plantão / Enfermaria',
      badgeCor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
      icone: 'stethoscope',
      borda: 'border-l-4 border-l-emerald-500'
    },
    estudo: {
      rotulo: 'MedQuest & Anki',
      badgeCor: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
      icone: 'book-open',
      borda: 'border-l-4 border-l-purple-500'
    },
    treino: {
      rotulo: 'Treino & Bio',
      badgeCor: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
      icone: 'dumbbell',
      borda: 'border-l-4 border-l-amber-500'
    },
    recuperacao: {
      rotulo: 'Recuperação / Sono',
      badgeCor: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
      icone: 'moon',
      borda: 'border-l-4 border-l-indigo-500'
    },
    compromisso: {
      rotulo: 'Compromisso',
      badgeCor: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
      icone: 'calendar',
      borda: 'border-l-4 border-l-sky-500'
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
      classe: 'bg-sky-500/20 text-sky-300 border border-sky-500/40 ring-1 ring-sky-400/40 animate-pulse',
      icone: 'play-circle'
    },
    pendente: {
      rotulo: 'Pendente',
      classe: 'bg-slate-800 text-slate-400 border border-slate-700',
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

  var estadoAtual = {
    blocos: [],
    filtroAtivo: 'todos',
    ultimoSync: null
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

  function carregarBlocosLocais() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(normalizarBloco);
        }
      }
    } catch (_) {}
    return [];
  }

  function salvarBlocosLocais(blocos) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blocos));
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

    var card = document.createElement('div');
    card.id = 'card-' + bloco.id;
    card.className = 'glass-card p-3 rounded-xl transition duration-150 space-y-2 ' +
                     catCfg.borda + ' ' +
                     (ehAtivoAgora
                       ? 'ring-1 ring-brand-400 bg-slate-900 shadow-md shadow-brand-500/10'
                       : (bloco.status === 'ativo' ? 'ring-1 ring-brand-400/50 bg-slate-900/90' : 'bg-slate-900/60'));

    // Linha 1: Horário, Categoria e Badge de Status
    var topo = document.createElement('div');
    topo.className = 'flex items-center justify-between gap-2';

    var faixaHoraria = document.createElement('div');
    faixaHoraria.className = 'flex items-center gap-2 flex-wrap';

    var horaTexto = document.createElement('span');
    horaTexto.className = 'font-mono text-xs font-bold text-white tracking-wide';
    horaTexto.textContent = bloco.inicio + (bloco.fim ? ' - ' + bloco.fim : '');

    var catBadge = document.createElement('span');
    catBadge.className = 'text-[9px] px-1.5 py-0.5 rounded font-medium border ' + catCfg.badgeCor;
    catBadge.textContent = catCfg.rotulo;

    faixaHoraria.append(horaTexto, catBadge);

    if (ehAtivoAgora) {
      var liveBadge = document.createElement('span');
      liveBadge.className = 'text-[9px] px-1.5 py-0.5 rounded font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse';
      liveBadge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> AGORA ' + (tempoInfo.rotulo ? '(' + tempoInfo.rotulo + ')' : '');
      faixaHoraria.append(liveBadge);
    } else if (tempoInfo.rotulo && bloco.status === 'pendente') {
      var proxBadge = document.createElement('span');
      proxBadge.className = 'text-[8.5px] px-1.5 py-0.5 rounded font-medium bg-slate-800 text-slate-300 border border-slate-700';
      proxBadge.textContent = tempoInfo.rotulo;
      faixaHoraria.append(proxBadge);
    }

    var statusBadge = document.createElement('span');
    statusBadge.className = 'text-[9.5px] px-2 py-0.5 rounded-full font-bold ' + stCfg.classe;
    statusBadge.textContent = stCfg.rotulo;

    topo.append(faixaHoraria, statusBadge);
    card.append(topo);

    // Linha 2: Título e Notas/Instruções
    var corpo = document.createElement('div');
    corpo.className = 'space-y-0.5';

    var tituloEl = document.createElement('h4');
    tituloEl.className = 'text-xs sm:text-sm font-bold text-white flex items-center gap-1.5';
    tituloEl.textContent = bloco.titulo;
    corpo.append(tituloEl);

    if (bloco.nota) {
      var notaEl = document.createElement('p');
      notaEl.className = 'text-[11px] text-slate-300 font-medium leading-relaxed pl-1 border-l border-slate-700';
      notaEl.textContent = bloco.nota;
      corpo.append(notaEl);
    }
    card.append(corpo);

    // Linha 3: Barra de Ações Rápidas em 1 Toque
    var acoes = document.createElement('div');
    acoes.className = 'flex items-center justify-end gap-1.5 pt-1 border-t border-slate-800/80 text-[10px] font-medium';

    if (bloco.status !== 'concluido') {
      var btnConcluir = document.createElement('button');
      btnConcluir.type = 'button';
      btnConcluir.className = 'px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition flex items-center gap-1';
      btnConcluir.innerHTML = '<i data-lucide="check" class="w-3 h-3"></i> Concluir';
      btnConcluir.onclick = function() { RotinaTimeline.alterarStatus(bloco.id, 'concluido'); };
      acoes.append(btnConcluir);
    }

    if (bloco.status !== 'adiado' && bloco.status !== 'concluido') {
      var btnAdiar = document.createElement('button');
      btnAdiar.type = 'button';
      btnAdiar.className = 'px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition flex items-center gap-1';
      btnAdiar.innerHTML = '<i data-lucide="clock" class="w-3 h-3"></i> Adiar (+30m)';
      btnAdiar.onclick = function() { RotinaTimeline.adiarBloco(bloco.id, 30); };
      acoes.append(btnAdiar);
    }

    if (bloco.status !== 'pulado' && bloco.status !== 'concluido') {
      var btnPular = document.createElement('button');
      btnPular.type = 'button';
      btnPular.className = 'px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition flex items-center gap-1';
      btnPular.innerHTML = '<i data-lucide="x" class="w-3 h-3"></i> Pular';
      btnPular.onclick = function() { RotinaTimeline.alterarStatus(bloco.id, 'pulado'); };
      acoes.append(btnPular);
    }

    if (bloco.status === 'concluido' || bloco.status === 'pulado') {
      var btnReabrir = document.createElement('button');
      btnReabrir.type = 'button';
      btnReabrir.className = 'px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1';
      btnReabrir.innerHTML = '<i data-lucide="rotate-ccw" class="w-3 h-3"></i> Reabrir';
      btnReabrir.onclick = function() { RotinaTimeline.alterarStatus(bloco.id, 'pendente'); };
      acoes.append(btnReabrir);
    }

    card.append(acoes);
    return card;
  }

  function renderizarEmptyState(container) {
    var box = document.createElement('div');
    box.className = 'glass-card p-6 rounded-2xl text-center space-y-3 border border-slate-800';

    var iconeWrap = document.createElement('div');
    iconeWrap.className = 'w-10 h-10 mx-auto rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center';
    iconeWrap.innerHTML = '<i data-lucide="calendar-check" class="w-5 h-5"></i>';

    var tit = document.createElement('h4');
    tit.className = 'text-xs sm:text-sm font-bold text-white';
    tit.textContent = 'Nenhum bloco agendado para hoje';

    var desc = document.createElement('p');
    desc.className = 'text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed';
    desc.textContent = 'Sua grade de plantão, rodízio e estudos MedQuest pode ser sincronizada via Agenda Google ou ajustada diretamente no bot Telegram.';

    var acoes = document.createElement('div');
    acoes.className = 'flex items-center justify-center gap-2 pt-2';

    var btnGrade = document.createElement('button');
    btnGrade.type = 'button';
    btnGrade.className = 'px-3 py-1.5 rounded-lg bg-brand-500/20 text-brand-300 border border-brand-500/40 text-xs font-bold hover:bg-brand-500/30 transition flex items-center gap-1.5';
    btnGrade.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> Carregar Grade Padrão';
    btnGrade.onclick = function() { RotinaTimeline.carregarGradePadrao(); };

    acoes.append(btnGrade);
    box.append(iconeWrap, tit, desc, acoes);
    container.append(box);
  }

  function renderizar(blocosEntrada, containerId) {
    var cId = containerId || 'rotina-blocos-container';
    var container = document.getElementById(cId);
    if (!container) return;

    var lista = Array.isArray(blocosEntrada) && blocosEntrada.length > 0
      ? blocosEntrada.map(normalizarBloco)
      : carregarBlocosLocais();

    estadoAtual.blocos = lista;
    renderizarHeaderContadores(lista);

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
        btn.className = 'btn-filtro-rotina px-2.5 py-1 rounded-lg text-xs font-bold bg-brand-500/20 text-brand-300 border border-brand-500/40 transition';
      } else {
        btn.className = 'btn-filtro-rotina px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200 transition';
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

  var QUEUE_KEY = 'rotina_fila_mutacoes_v1';

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
    } catch (_) {}
  }

  function processarFilaOffline() {
    if (!navigator.onLine) return;
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return;
      var fila = JSON.parse(raw);
      if (!Array.isArray(fila) || fila.length === 0) return;

      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/status';
      var item = fila[0];

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      }).then(function(res) {
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
      }).catch(function() {});
    } catch (_) {}
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

  function carregarBlocosDoServidor(callback) {
    if (!navigator.onLine) {
      if (typeof callback === 'function') callback(null);
      return;
    }
    try {
      var endpoint = (window.BACKEND_URL || '') + '/api/rotina/blocos';
      fetch(endpoint).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && Array.isArray(data.blocos) && data.blocos.length > 0) {
          salvarBlocosLocais(data.blocos);
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
        body: JSON.stringify({})
      }).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && Array.isArray(data.blocos)) {
          salvarBlocosLocais(data.blocos);
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

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', function() {
      processarFilaOffline();
      carregarBlocosDoServidor();
    });
  }

  // Exportação Pública do Módulo
  window.RotinaTimeline = {
    renderizar: renderizar,
    alterarStatus: alterarStatus,
    adiarBloco: adiarBloco,
    ativarModoDescanso: ativarModoDescanso,
    aplicarFiltro: aplicarFiltro,
    carregarGradePadrao: carregarGradePadrao,
    carregarBlocosLocais: carregarBlocosLocais,
    salvarBlocosLocais: salvarBlocosLocais,
    carregarBlocosDoServidor: carregarBlocosDoServidor,
    sincronizarAgendaGoogle: sincronizarAgendaGoogle,
    processarFilaOffline: processarFilaOffline,
    converterHoraEmMinutos: converterHoraEmMinutos,
    formatarMinutosEmHora: formatarMinutosEmHora,
    calcularEstadoTempoBloco: calcularEstadoTempoBloco,
    normalizarBloco: normalizarBloco,
    CATEGORIA_CONFIG: CATEGORIA_CONFIG,
    STATUS_CONFIG: STATUS_CONFIG
  };

})(typeof window !== 'undefined' ? window : this);
