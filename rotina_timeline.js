/**
 * rotina_timeline.js
 * Módulo Desacoplado v2.0: Time-Blocking, Pomodoro MedQuest, Modo Plantão & Rotina Viva do Cockpit PWA
 * Gerencia a timeline diária do médico (plantão, estudos MedQuest/Anki, treino, recuperação, lifestyle).
 * Suporta ações rápidas em 1 toque, timer Pomodoro embutido, criação/edição de blocos, metas diárias,
 * filtros, persistência local (LocalStorage + IndexedDB) e sincronização resiliente com Google Calendar.
 */

(function(window) {
  "use strict";

  var STORAGE_KEY = "rotina_blocos_v1";
  var SYNC_STATE_KEY = "rotina_sync_status_v1";
  var STORAGE_KEY_DUVIDAS = "rotina_duvidas_v1";
  var STORAGE_KEY_METAS = "rotina_metas_diarias_v1";
  var QUEUE_KEY = "rotina_fila_mutacoes_v1";

  var filaProcessando = false;

  function dispararHaptic(tipo) {
    try {
      if (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
        if (tipo === "sucesso") {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
        } else if (tipo === "aviso") {
          window.Telegram.WebApp.HapticFeedback.notificationOccurred("warning");
        } else {
          window.Telegram.WebApp.HapticFeedback.impactOccurred("light");
        }
      } else if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(tipo === "sucesso" ? [15, 30, 20] : 12);
      }
    } catch (_) {}
  }

  function obterApiBaseUrl() {
    if (typeof window !== "undefined") {
      if (window.BACKEND_URL && typeof window.BACKEND_URL === "string" && window.BACKEND_URL.trim()) {
        return window.BACKEND_URL.replace(/\/+$/, "");
      }
      if (window.ULTRA_CONFIG && window.ULTRA_CONFIG.HTTP_BASE) {
        return window.ULTRA_CONFIG.HTTP_BASE.replace(/\/+$/, "");
      }
      try {
        var saved = localStorage.getItem("cockpit_backend_url") || localStorage.getItem("ULTRA_BACKEND_URL");
        if (saved && !saved.includes("ultra-rotina-backend.onrender.com")) {
          return saved.replace(/\/+$/, "");
        }
      } catch (e) {}
      if (window.location && window.location.origin && !window.location.hostname.includes("github.io")) {
        return window.location.origin;
      }
    }
    return "https://rotina-tt8n.onrender.com";
  }

  var CATEGORIA_CONFIG = {
    plantao: {
      rotulo: "Plantão / Enfermaria",
      badgeCor: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
      icone: "stethoscope",
      borda: "border-l-[3.5px] border-l-emerald-500",
      corBarra: "bg-emerald-500"
    },
    estudo: {
      rotulo: "MedQuest & Anki",
      badgeCor: "bg-purple-500/15 text-purple-300 border-purple-500/30",
      icone: "book-open",
      borda: "border-l-[3.5px] border-l-purple-500",
      corBarra: "bg-purple-500"
    },
    treino: {
      rotulo: "Treino & Bio",
      badgeCor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      icone: "dumbbell",
      borda: "border-l-[3.5px] border-l-amber-500",
      corBarra: "bg-amber-500"
    },
    recuperacao: {
      rotulo: "Recuperação / Sono",
      badgeCor: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
      icone: "moon",
      borda: "border-l-[3.5px] border-l-indigo-500",
      corBarra: "bg-indigo-500"
    },
    lifestyle: {
      rotulo: "Vida & Lifestyle",
      badgeCor: "bg-rose-500/15 text-rose-300 border-rose-500/30",
      icone: "heart",
      borda: "border-l-[3.5px] border-l-rose-500",
      corBarra: "bg-rose-500"
    },
    compromisso: {
      rotulo: "Compromisso",
      badgeCor: "bg-sky-500/15 text-sky-300 border-sky-500/30",
      icone: "calendar",
      borda: "border-l-[3.5px] border-l-sky-500",
      corBarra: "bg-sky-500"
    }
  };

  var STATUS_CONFIG = {
    concluido: {
      rotulo: "Concluído",
      classe: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
      icone: "check-circle"
    },
    ativo: {
      rotulo: "Em Andamento",
      classe: "bg-sky-500/20 text-sky-300 border border-sky-500/40 ring-1 ring-sky-400/40",
      icone: "play-circle"
    },
    pendente: {
      rotulo: "Pendente",
      classe: "bg-slate-800/80 text-slate-300 border border-slate-700/80",
      icone: "clock"
    },
    adiado: {
      rotulo: "Adiado (+30m)",
      classe: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
      icone: "clock-rewind"
    },
    pulado: {
      rotulo: "Pulado",
      classe: "bg-rose-500/10 text-rose-400 border border-rose-500/30 line-through opacity-70",
      icone: "x-circle"
    },
    descanso: {
      rotulo: "Descanso Ativo",
      classe: "bg-teal-500/20 text-teal-300 border border-teal-500/40",
      icone: "coffee"
    }
  };

  var GRANDES_AREAS_R1 = ["Clínica", "Cirurgia", "Pediatria", "GO", "Preventiva"];

  function obterDataISO(modo) {
    var d = new Date();
    if (modo === "amanha") {
      d.setDate(d.getDate() + 1);
    }
    var y = d.getFullYear();
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var dia = ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + dia;
  }

  var estadoAtual = {
    blocos: [],
    filtroAtivo: "todos",
    ultimoSync: null,
    modoData: "hoje",
    dataISO: obterDataISO("hoje"),
    modoVisualizacao: "timeline", // "timeline" | "foco" | "semana"
    modoPlantaoAltoContraste: false,
    areaDuvidaSelecionada: "Clínica",
    pomodoro: {
      blocoId: null,
      segundosRestantes: 1500,
      duracaoTotal: 1500,
      rodando: false,
      timerId: null
    }
  };

  function normalizarBloco(raw, idx) {
    var b = raw || {};
    var id = String(b.id || "bloco-" + idx);
    var titulo = String(b.titulo || b.nome || "Atividade Programada");
    var inicio = String(b.inicio || b.horario_inicio || (b.horario ? b.horario.split("-")[0] : "") || "08:00").trim();
    var fim = String(b.fim || b.horario_fim || (b.horario ? b.horario.split("-")[1] : "") || "09:00").trim();
    var categoria = (b.categoria || "").toLowerCase();
    if (!CATEGORIA_CONFIG[categoria]) {
      if (/plant[aã]o|enfermaria|uti|leito|sala\s+vermelha|hospital|internato|ambul/i.test(titulo)) categoria = "plantao";
      else if (/medquest|anki|estudo|quest[õo]es|aula|revis[aã]o|resid[eê]ncia/i.test(titulo)) categoria = "estudo";
      else if (/treino|academia|cardio|muscula|corrida/i.test(titulo)) categoria = "treino";
      else if (/sono|descanso|cochilo|recupera/i.test(titulo)) categoria = "recuperacao";
      else if (/viol[aã]o|m[uú]sica|guitarra|lazer|leitura|livro|pessoal|hobby|ingl[eê]s|fam[ií]lia|lifestyle|vida/i.test(titulo)) categoria = "lifestyle";
      else categoria = "compromisso";
    }

    var status = (b.status || (b.ativo ? "ativo" : "pendente")).toLowerCase();
    if (!STATUS_CONFIG[status]) status = "pendente";

    return {
      id: id,
      titulo: titulo,
      inicio: inicio,
      fim: fim,
      categoria: categoria,
      status: status,
      nota: String(b.nota || b.descricao || ""),
      ativo: Boolean(b.ativo || status === "ativo")
    };
  }

  function carregarBlocosLocais(dataISO) {
    var alvoData = dataISO || estadoAtual.dataISO || obterDataISO("hoje");
    var chaveData = STORAGE_KEY + "_" + alvoData;
    try {
      var raw = localStorage.getItem(chaveData);
      if (!raw && alvoData === obterDataISO("hoje")) {
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
    var alvoData = dataISO || estadoAtual.dataISO || obterDataISO("hoje");
    var chaveData = STORAGE_KEY + "_" + alvoData;
    try {
      localStorage.setItem(chaveData, JSON.stringify(blocos));
      if (alvoData === obterDataISO("hoje")) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(blocos));
      }
      atualizarBadgeSync("Salvo offline");
    } catch (_) {}
  }

  function atualizarBadgeSync(texto, online) {
    var badge = document.getElementById("rotina-sync-badge");
    if (!badge) return;
    badge.textContent = texto || (online ? "Sincronizado" : "Offline");
    if (online) {
      badge.className = "text-[9.5px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1";
    } else {
      badge.className = "text-[9.5px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1";
    }
  }

  function converterHoraEmMinutos(horaStr) {
    if (!horaStr || typeof horaStr !== "string") return -1;
    var partes = horaStr.split(":");
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
    return ("0" + h).slice(-2) + ":" + ("0" + m).slice(-2);
  }

  function calcularEstadoTempoBloco(bloco) {
    var agora = new Date();
    var minAgora = agora.getHours() * 60 + agora.getMinutes();
    var minIni = converterHoraEmMinutos(bloco.inicio);
    var minFim = converterHoraEmMinutos(bloco.fim);
    if (minIni < 0 || minFim < 0) return { emAndamento: false, rotulo: "", progressoPct: 0 };

    if (minAgora >= minIni && minAgora <= minFim) {
      var dur = minFim - minIni;
      var passados = minAgora - minIni;
      var pct = dur > 0 ? Math.min(100, Math.max(0, Math.round((passados / dur) * 100))) : 50;
      var restantes = minFim - minAgora;
      return {
        emAndamento: true,
        rotulo: restantes <= 1 ? "Terminando agora" : "Restam " + restantes + "m",
        progressoPct: pct
      };
    }
    if (minAgora < minIni && (minIni - minAgora) <= 30) {
      return {
        emAndamento: false,
        rotulo: "Inicia em " + (minIni - minAgora) + "m",
        progressoPct: 0
      };
    }
    return { emAndamento: false, rotulo: "", progressoPct: 0 };
  }

  // ==========================================
  // Radar "AGORA" em Tempo Real & Relógio Vivo
  // ==========================================

  function atualizarRadarAgoraVivo(blocos) {
    var radarTexto = document.getElementById("rotina-radar-agora-texto");
    var relogioVivo = document.getElementById("rotina-relogio-vivo");
    var agora = new Date();
    var h = ("0" + agora.getHours()).slice(-2);
    var m = ("0" + agora.getMinutes()).slice(-2);

    if (relogioVivo) {
      relogioVivo.textContent = h + ":" + m;
    }

    if (!radarTexto) return;
    var lista = blocos || estadoAtual.blocos || [];
    var blocoAgora = null;
    var proximoBloco = null;
    var minAgora = agora.getHours() * 60 + agora.getMinutes();
    var menorDiff = 99999;

    for (var i = 0; i < lista.length; i++) {
      var b = lista[i];
      if (b.status === "concluido" || b.status === "pulado") continue;
      var info = calcularEstadoTempoBloco(b);
      if (info.emAndamento) {
        blocoAgora = { bloco: b, info: info };
        break;
      }
      var mIni = converterHoraEmMinutos(b.inicio);
      if (mIni > minAgora && (mIni - minAgora) < menorDiff) {
        menorDiff = mIni - minAgora;
        proximoBloco = b;
      }
    }

    if (blocoAgora) {
      radarTexto.textContent = "AGORA: " + blocoAgora.bloco.titulo + " (" + blocoAgora.info.rotulo + " · " + blocoAgora.info.progressoPct + "%)";
    } else if (proximoBloco) {
      radarTexto.textContent = "PRÓXIMO (" + proximoBloco.inicio + "): " + proximoBloco.titulo;
    } else if (lista.length > 0) {
      radarTexto.textContent = "Todos os blocos previstos para o turno foram revisados.";
    } else {
      radarTexto.textContent = "Sem blocos ativos no momento · Toque em \"+ Bloco\" ou Sincronize.";
    }
  }

  function renderizarHeaderContadores(blocos) {
    var totalEl = document.getElementById("rotina-contador-total");
    var concluidosEl = document.getElementById("rotina-contador-concluidos");
    var progressoBarra = document.getElementById("rotina-barra-progresso");

    var total = blocos.length;
    var concluidos = blocos.filter(function(b) { return b.status === "concluido" || b.status === "descanso"; }).length;
    var pct = total > 0 ? Math.round((concluidos / total) * 100) : 0;

    if (totalEl) totalEl.textContent = String(total);
    if (concluidosEl) concluidosEl.textContent = String(concluidos);
    if (progressoBarra && progressoBarra.style) progressoBarra.style.width = pct + "%";

    atualizarRadarAgoraVivo(blocos);
  }

  // ==========================================
  // Gamificação & Metas Diárias R1 (MedQuest, Anki, Água)
  // ==========================================

  function carregarMetasDiarias() {
    var hoje = obterDataISO("hoje");
    try {
      var raw = localStorage.getItem(STORAGE_KEY_METAS + "_" + hoje);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === "object") return p;
      }
    } catch (_) {}
    return { questoes: 0, metaQuestoes: 50, anki: 0, metaAnki: 60, agua: 0, metaAgua: 3000 };
  }

  function salvarMetasDiarias(metas) {
    var hoje = obterDataISO("hoje");
    try {
      localStorage.setItem(STORAGE_KEY_METAS + "_" + hoje, JSON.stringify(metas));
    } catch (_) {}
  }

  function renderizarMetasDiarias() {
    var metas = carregarMetasDiarias();
    var qEl = document.getElementById("meta-questoes-hoje-val");
    var aEl = document.getElementById("meta-anki-hoje-val");
    var wEl = document.getElementById("meta-agua-hoje-val");

    if (qEl) qEl.textContent = metas.questoes + "/" + (metas.metaQuestoes || 50) + " q";
    if (aEl) aEl.textContent = metas.anki + "/" + (metas.metaAnki || 60);
    if (wEl) wEl.textContent = (metas.agua / 1000).toFixed(1) + "/" + ((metas.metaAgua || 3000) / 1000).toFixed(1) + "L";
  }

  function incrementarMetaDiaria(tipo, delta) {
    var metas = carregarMetasDiarias();
    var inc = Number(delta) || 1;
    if (tipo === "questoes") metas.questoes = Math.max(0, (metas.questoes || 0) + inc);
    else if (tipo === "anki") metas.anki = Math.max(0, (metas.anki || 0) + inc);
    else if (tipo === "agua") metas.agua = Math.max(0, (metas.agua || 0) + inc);

    salvarMetasDiarias(metas);
    renderizarMetasDiarias();
    dispararHaptic("sucesso");
    if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
      if (tipo === "questoes") window.copiarToast("🎯 +" + inc + " questões MedQuest contabilizadas hoje!");
      else if (tipo === "anki") window.copiarToast("🧠 +" + inc + " flashcards Anki revisados!");
      else if (tipo === "agua") window.copiarToast("💧 +" + inc + "ml de hidratação registrada!");
    }
  }

  // ==========================================
  // Timer Pomodoro / Focus Embutido nos Blocos de Estudo
  // ==========================================

  function formatarSegundosPomodoro(seg) {
    var s = Math.max(0, Math.floor(seg));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return ("0" + m).slice(-2) + ":" + ("0" + r).slice(-2);
  }

  function iniciarPomodoroBloco(blocoId, minutos) {
    var durSeg = (minutos || 25) * 60;
    var p = estadoAtual.pomodoro;

    if (p.timerId) {
      clearInterval(p.timerId);
      p.timerId = null;
    }

    if (p.blocoId === blocoId && p.rodando) {
      p.rodando = false;
      atualizarDisplayPomodoroCard(blocoId);
      return;
    }

    if (p.blocoId !== blocoId || p.segundosRestantes <= 0) {
      p.blocoId = blocoId;
      p.duracaoTotal = durSeg;
      p.segundosRestantes = durSeg;
    }

    p.rodando = true;
    dispararHaptic("light");

    if (typeof setInterval === "function") {
      p.timerId = setInterval(function() {
        if (!p.rodando) return;
        p.segundosRestantes = Math.max(0, p.segundosRestantes - 1);
        atualizarDisplayPomodoroCard(p.blocoId);
        if (p.segundosRestantes <= 0) {
          p.rodando = false;
          clearInterval(p.timerId);
          p.timerId = null;
          dispararHaptic("sucesso");
          if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
            window.copiarToast("🔔 Ciclo Pomodoro concluído! Faça 5m de pausa ou registre suas questões.");
          }
        }
      }, 1000);
    }
    atualizarDisplayPomodoroCard(blocoId);
  }

  function resetarPomodoroBloco(blocoId, minutos) {
    var p = estadoAtual.pomodoro;
    if (p.timerId) {
      clearInterval(p.timerId);
      p.timerId = null;
    }
    p.blocoId = blocoId;
    p.duracaoTotal = (minutos || 25) * 60;
    p.segundosRestantes = p.duracaoTotal;
    p.rodando = false;
    atualizarDisplayPomodoroCard(blocoId);
  }

  function atualizarDisplayPomodoroCard(blocoId) {
    var elTimer = document.getElementById("pomo-timer-" + blocoId);
    var elBtn = document.getElementById("pomo-btn-" + blocoId);
    var p = estadoAtual.pomodoro;
    if (elTimer) {
      elTimer.textContent = formatarSegundosPomodoro(p.blocoId === blocoId ? p.segundosRestantes : 1500);
    }
    if (elBtn) {
      elBtn.textContent = (p.blocoId === blocoId && p.rodando) ? "⏸ Pausar" : "▶ Foco 25m";
    }
  }

  // ==========================================
  // Cálculo de Aderência Semanal (7 Dias)
  // ==========================================

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
    var hojeISO = obterDataISO("hoje");

    for (var i = 6; i >= 0; i--) {
      var d = new Date(hojeObj.getTime() - (i * 86400000));
      var y = d.getFullYear();
      var m = ("0" + (d.getMonth() + 1)).slice(-2);
      var dia = ("0" + d.getDate()).slice(-2);
      var dataISO = y + "-" + m + "-" + dia;

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

        if (bloco.status === "concluido") {
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

    var pctSemanalEl = document.getElementById("aderencia-pct-semanal");
    var pctValorEl = document.getElementById("aderencia-pct-valor");
    var blocosDetalheEl = document.getElementById("aderencia-blocos-detalhe");
    var horasEstudoEl = document.getElementById("aderencia-horas-estudo");
    var horasPlantaoEl = document.getElementById("aderencia-horas-plantao");
    var barraProgressoEl = document.getElementById("aderencia-barra-progresso");

    if (pctSemanalEl) pctSemanalEl.textContent = String(ad.taxaGlobal);
    if (pctValorEl) pctValorEl.textContent = String(ad.taxaGlobal) + "%";
    if (blocosDetalheEl) blocosDetalheEl.textContent = ad.totalConcluidos + " de " + ad.totalPlanejados + " blocos";
    if (horasEstudoEl) horasEstudoEl.textContent = (ad.horasEstudoConcluidas || 0).toFixed(1) + "h";
    if (horasPlantaoEl) horasPlantaoEl.textContent = (ad.horasPlantaoConcluidas || 0).toFixed(1) + "h";
    if (barraProgressoEl && barraProgressoEl.style) barraProgressoEl.style.width = ad.taxaGlobal + "%";

    if (ad.eixos) {
      var mapEixos = [
        { id: "plantao", val: "aderencia-eixo-plantao-val", bar: "aderencia-eixo-plantao-bar" },
        { id: "estudo", val: "aderencia-eixo-estudo-val", bar: "aderencia-eixo-estudo-bar" },
        { id: "treino", val: "aderencia-eixo-treino-val", bar: "aderencia-eixo-treino-bar" },
        { id: "habitos", val: "aderencia-eixo-habitos-val", bar: "aderencia-eixo-habitos-bar" }
      ];
      for (var i = 0; i < mapEixos.length; i++) {
        var item = mapEixos[i];
        var info = ad.eixos[item.id] || { taxa: 0 };
        var valEl = document.getElementById(item.val);
        var barEl = document.getElementById(item.bar);
        if (valEl) valEl.textContent = info.taxa + "%";
        if (barEl && barEl.style) barEl.style.width = info.taxa + "%";
      }
    }
  }

  // ==========================================
  // Construção do Card de Bloco da Timeline Viva
  // ==========================================

  function criarCardBloco(bloco) {
    var catCfg = CATEGORIA_CONFIG[bloco.categoria] || CATEGORIA_CONFIG.compromisso;
    var stCfg = STATUS_CONFIG[bloco.status] || STATUS_CONFIG.pendente;
    var tempoInfo = calcularEstadoTempoBloco(bloco);
    var ehAtivoAgora = tempoInfo.emAndamento && bloco.status !== "concluido" && bloco.status !== "pulado";
    var ehConcluido = bloco.status === "concluido";
    var ehPulado = bloco.status === "pulado";
    var duracaoHoras = calcularDuracaoHorasLocal(bloco.inicio, bloco.fim);

    var card = document.createElement("div");
    card.id = "card-" + bloco.id;
    card.className = "glass-card p-3.5 rounded-2xl transition duration-150 space-y-2.5 relative " +
                     catCfg.borda + " " +
                     (ehAtivoAgora
                       ? "ring-1.5 ring-brand-400 bg-slate-900/95 shadow-lg shadow-brand-500/10"
                       : (ehConcluido
                           ? "bg-slate-950/60 border border-slate-800/60 opacity-80"
                           : (ehPulado
                               ? "bg-slate-950/50 border border-slate-800/40 opacity-60"
                               : (bloco.status === "ativo"
                                   ? "ring-1 ring-brand-400/50 bg-slate-900/90"
                                   : "bg-slate-900/70 hover:bg-slate-900/90 border border-slate-800/80"))));

    // Linha 1: Régua Horária, Duração, Categoria e Status
    var topo = document.createElement("div");
    topo.className = "flex items-center justify-between gap-2";

    var faixaHoraria = document.createElement("div");
    faixaHoraria.className = "flex items-center gap-2 flex-wrap";

    var iconeCat = document.createElement("i");
    iconeCat.setAttribute("data-lucide", catCfg.icone);
    iconeCat.className = "w-3.5 h-3.5 " + (ehAtivoAgora ? "text-brand-400" : "text-slate-400");

    var horaTexto = document.createElement("span");
    horaTexto.className = "font-mono text-xs sm:text-[13px] font-bold text-white tracking-tight";
    horaTexto.textContent = bloco.inicio + (bloco.fim ? " - " + bloco.fim : "");

    var durBadge = document.createElement("span");
    durBadge.className = "text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-400 border border-slate-700/70";
    durBadge.textContent = duracaoHoras + "h";

    var catBadge = document.createElement("span");
    catBadge.className = "text-[11px] px-2.5 py-0.5 rounded-md font-semibold border " + catCfg.badgeCor;
    catBadge.textContent = catCfg.rotulo;

    faixaHoraria.append(iconeCat, horaTexto, durBadge, catBadge);

    if (ehAtivoAgora) {
      var liveBadge = document.createElement("span");
      liveBadge.className = "text-[11px] px-2.5 py-0.5 rounded-md font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 shadow-sm";
      liveBadge.innerHTML = "<span class=\"w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse\"></span> AGORA" + (tempoInfo.rotulo ? " · " + tempoInfo.rotulo : "");
      faixaHoraria.append(liveBadge);
    } else if (tempoInfo.rotulo && bloco.status === "pendente") {
      var proxBadge = document.createElement("span");
      proxBadge.className = "text-[11px] px-2 py-0.5 rounded-md font-medium bg-slate-800/90 text-slate-300 border border-slate-700/80";
      proxBadge.textContent = "⏱️ " + tempoInfo.rotulo;
      faixaHoraria.append(proxBadge);
    }

    topo.append(faixaHoraria);

    var direitaTopo = document.createElement("div");
    direitaTopo.className = "flex items-center gap-1.5";

    if (!ehAtivoAgora) {
      var statusBadge = document.createElement("span");
      statusBadge.className = "text-[11px] px-2.5 py-0.5 rounded-full font-bold " + stCfg.classe;
      statusBadge.textContent = stCfg.rotulo;
      direitaTopo.append(statusBadge);
    }

    var btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-[11px]";
    btnEditar.title = "Editar Bloco";
    btnEditar.innerHTML = "<i data-lucide=\"edit-3\" class=\"w-3.5 h-3.5\"></i>";
    btnEditar.onclick = function(e) {
      if (e && e.stopPropagation) e.stopPropagation();
      abrirModalBloco(bloco.id);
    };
    direitaTopo.append(btnEditar);

    topo.append(direitaTopo);
    card.append(topo);

    // Barra de Decaimento Temporal em Tempo Real (exclusiva para o bloco AGORA)
    if (ehAtivoAgora) {
      var barraLiveWrap = document.createElement("div");
      barraLiveWrap.className = "w-full h-1.5 bg-slate-800 rounded-full overflow-hidden";
      barraLiveWrap.innerHTML = "<div class=\"h-full " + (catCfg.corBarra || "bg-brand-500") + " transition-all duration-500\" style=\"width:" + tempoInfo.progressoPct + "%\"></div>";
      card.append(barraLiveWrap);
    }

    // Linha 2: Título, Notas, Timer Pomodoro Embutido (se Estudo) & Atalhos Zero-Click
    var corpo = document.createElement("div");
    corpo.className = "space-y-2";

    var tituloEl = document.createElement("h4");
    tituloEl.className = "text-xs sm:text-sm font-bold " + (ehConcluido ? "text-slate-300 line-through" : "text-white") + " flex items-center gap-1.5";
    tituloEl.textContent = bloco.titulo;
    corpo.append(tituloEl);

    if (bloco.nota) {
      var notaEl = document.createElement("p");
      notaEl.className = "text-xs text-slate-200/90 font-medium leading-relaxed pl-2.5 py-1.5 rounded-lg bg-slate-950/50 border-l-2 border-slate-700/80";
      notaEl.textContent = bloco.nota;
      corpo.append(notaEl);
    }

    // Widget Pomodoro & Contabilizador de Questões nos blocos de Estudo não concluídos
    if (bloco.categoria === "estudo" && !ehConcluido && !ehPulado) {
      var pomoBox = document.createElement("div");
      pomoBox.className = "p-2 rounded-xl bg-purple-950/25 border border-purple-500/25 flex items-center justify-between gap-2 flex-wrap";

      var pomoEsq = document.createElement("div");
      pomoEsq.className = "flex items-center gap-2";

      var pomoTimer = document.createElement("span");
      pomoTimer.id = "pomo-timer-" + bloco.id;
      pomoTimer.className = "font-mono text-xs font-extrabold text-purple-200 bg-purple-500/20 px-2 py-1 rounded-lg border border-purple-500/30";
      var segExibir = (estadoAtual.pomodoro.blocoId === bloco.id) ? estadoAtual.pomodoro.segundosRestantes : 1500;
      pomoTimer.textContent = formatarSegundosPomodoro(segExibir);

      var btnPomoPlay = document.createElement("button");
      btnPomoPlay.id = "pomo-btn-" + bloco.id;
      btnPomoPlay.type = "button";
      btnPomoPlay.className = "px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold transition active:scale-95";
      btnPomoPlay.textContent = (estadoAtual.pomodoro.blocoId === bloco.id && estadoAtual.pomodoro.rodando) ? "⏸ Pausar" : "▶ Foco 25m";
      btnPomoPlay.onclick = function() { iniciarPomodoroBloco(bloco.id, 25); };

      var btnPomo50 = document.createElement("button");
      btnPomo50.type = "button";
      btnPomo50.className = "px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-200 border border-purple-500/30 text-[10px] font-bold transition active:scale-95";
      btnPomo50.textContent = "50m";
      btnPomo50.onclick = function() {
        resetarPomodoroBloco(bloco.id, 50);
        iniciarPomodoroBloco(bloco.id, 50);
      };

      pomoEsq.append(pomoTimer, btnPomoPlay, btnPomo50);

      var pomoDir = document.createElement("div");
      pomoDir.className = "flex items-center gap-1";

      var btnMaisQuestoes = document.createElement("button");
      btnMaisQuestoes.type = "button";
      btnMaisQuestoes.className = "px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold transition active:scale-95";
      btnMaisQuestoes.textContent = "+10 Questões";
      btnMaisQuestoes.onclick = function() { incrementarMetaDiaria("questoes", 10); };

      var btnDuvidaRapida = document.createElement("button");
      btnDuvidaRapida.type = "button";
      btnDuvidaRapida.className = "px-2 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 text-[10px] font-bold transition active:scale-95";
      btnDuvidaRapida.textContent = "+ Dúvida";
      btnDuvidaRapida.onclick = function() {
        var inp = document.getElementById("input-nova-duvida-cockpit");
        if (inp && typeof inp.focus === "function") inp.focus();
      };

      pomoDir.append(btnMaisQuestoes, btnDuvidaRapida);
      pomoBox.append(pomoEsq, pomoDir);
      corpo.append(pomoBox);
    }

    // Atalhos Clínicos Zero-Click em Blocos de Plantão
    if (bloco.categoria === "plantao" && !ehConcluido && !ehPulado) {
      var ctxPlantao = document.createElement("div");
      ctxPlantao.className = "flex items-center gap-1.5 flex-wrap pt-0.5";
      ctxPlantao.innerHTML =
        "<button type=\"button\" onclick=\"if(typeof abrirModalSbarPassagem===\function\) abrirModalSbarPassagem();\" class=\"text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 transition active:scale-95 font-semibold\"><i data-lucide=\"layers\" class=\"w-3.5 h-3.5\"></i> Passagem SBAR</button>" +
        "<button type=\"button\" onclick=\"if(typeof switchTab===\function\) switchTab(\tab-plantao\);\" class=\"text-[11px] px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 flex items-center gap-1 transition active:scale-95 font-semibold\"><i data-lucide=\"flame\" class=\"w-3.5 h-3.5\"></i> Calculadoras & DVA</button>";
      corpo.append(ctxPlantao);
    }

    card.append(corpo);

    // Linha 3: Barra de Ações Rápidas (Alvos ergonômicos 42px & Thumb-Zone Fitts)
    var acoes = document.createElement("div");
    acoes.className = "flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs font-semibold";

    if (bloco.status === "concluido" || bloco.status === "pulado") {
      var btnReabrir = document.createElement("button");
      btnReabrir.type = "button";
      btnReabrir.className = "min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition active:scale-95 flex items-center gap-1.5 shadow-sm text-xs font-medium";
      btnReabrir.innerHTML = "<i data-lucide=\"rotate-ccw\" class=\"w-4 h-4\"></i> Reabrir Bloco";
      btnReabrir.onclick = function() {
        dispararHaptic("light");
        RotinaTimeline.alterarStatus(bloco.id, "pendente");
      };
      acoes.append(btnReabrir);
    } else {
      var acoesEsq = document.createElement("div");
      acoesEsq.className = "flex items-center gap-1.5";

      if (bloco.status !== "pulado") {
        var btnPular = document.createElement("button");
        btnPular.type = "button";
        btnPular.className = "min-h-[42px] px-2.5 py-2 rounded-xl bg-slate-800/60 hover:bg-rose-500/15 text-slate-400 hover:text-rose-300 border border-slate-800 transition active:scale-95 flex items-center justify-center gap-1 text-[11px] font-semibold";
        btnPular.innerHTML = "<i data-lucide=\"x\" class=\"w-3.5 h-3.5\"></i> Pular";
        btnPular.onclick = function() {
          dispararHaptic("aviso");
          RotinaTimeline.alterarStatus(bloco.id, "pulado");
        };
        acoesEsq.append(btnPular);
      }

      if (bloco.status !== "adiado") {
        var btnAdiar = document.createElement("button");
        btnAdiar.type = "button";
        btnAdiar.className = "min-h-[42px] px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition active:scale-95 flex items-center gap-1.5 shadow-sm text-xs font-bold";
        btnAdiar.innerHTML = "<i data-lucide=\"clock\" class=\"w-3.5 h-3.5\"></i> +30m";
        btnAdiar.onclick = function() {
          dispararHaptic("light");
          RotinaTimeline.adiarBloco(bloco.id, 30);
        };
        acoesEsq.append(btnAdiar);
      }

      var btnConcluir = document.createElement("button");
      btnConcluir.type = "button";
      btnConcluir.className = "min-h-[42px] flex-1 max-w-[150px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/50 transition active:scale-95 flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950 font-bold text-xs";
      btnConcluir.innerHTML = "<i data-lucide=\"check\" class=\"w-4 h-4\"></i> Concluir";
      btnConcluir.onclick = function() {
        dispararHaptic("sucesso");
        RotinaTimeline.alterarStatus(bloco.id, "concluido");
      };

      acoes.append(acoesEsq, btnConcluir);
    }

    card.append(acoes);
    return card;
  }

  function renderizarEmptyState(container) {
    var ehAmanha = estadoAtual.modoData === "amanha";
    var box = document.createElement("div");
    box.className = "glass-card p-6 rounded-2xl text-center space-y-3 border border-slate-800 bg-slate-900/40";

    var iconeWrap = document.createElement("div");
    iconeWrap.className = "w-10 h-10 mx-auto rounded-full bg-brand-500/10 text-brand-400 flex items-center justify-center";
    iconeWrap.innerHTML = "<i data-lucide=\"calendar\" class=\"w-5 h-5\"></i>";

    var tit = document.createElement("h4");
    tit.className = "text-xs sm:text-sm font-bold text-white";
    tit.textContent = ehAmanha ? "Nenhum compromisso agendado para amanhã" : "Nenhum compromisso agendado para hoje";

    var desc = document.createElement("p");
    desc.className = "text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed";
    desc.textContent = "Seus eventos e sessões de estudo da Agenda Google (moraes.wagg@gmail.com) são sincronizados em tempo real, ou você pode criar um bloco personalizado.";

    var acoes = document.createElement("div");
    acoes.className = "flex items-center justify-center gap-2 pt-2 flex-wrap";

    var btnNovo = document.createElement("button");
    btnNovo.type = "button";
    btnNovo.className = "px-3 py-1.5 rounded-lg bg-brand-500/20 text-brand-300 border border-brand-500/40 text-xs font-bold hover:bg-brand-500/30 transition flex items-center gap-1.5";
    btnNovo.innerHTML = "<i data-lucide=\"plus\" class=\"w-3.5 h-3.5\"></i> Criar Bloco Agora";
    btnNovo.onclick = function() { RotinaTimeline.abrirModalBloco(); };

    var btnSync = document.createElement("button");
    btnSync.type = "button";
    btnSync.className = "px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold hover:bg-emerald-500/30 transition flex items-center gap-1.5";
    btnSync.innerHTML = "<i data-lucide=\"rotate-ccw\" class=\"w-3.5 h-3.5\"></i> Sincronizar Google Calendar";
    btnSync.onclick = function() { RotinaTimeline.sincronizarAgendaGoogle(); };

    var btnPadrao = document.createElement("button");
    btnPadrao.type = "button";
    btnPadrao.className = "px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium hover:bg-slate-700 transition flex items-center gap-1.5";
    btnPadrao.innerHTML = "Carregar Grade Padrão";
    btnPadrao.onclick = function() { RotinaTimeline.carregarGradePadrao(); };

    acoes.append(btnNovo, btnSync, btnPadrao);
    box.append(iconeWrap, tit, desc, acoes);
    container.append(box);
  }

  function renderizarPanoramaSemanal(container) {
    var hojeObj = new Date();
    var diasSemanaNomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    var grid = document.createElement("div");
    grid.className = "space-y-2";

    for (var i = 6; i >= 0; i--) {
      var d = new Date(hojeObj.getTime() - (i * 86400000));
      var y = d.getFullYear();
      var m = ("0" + (d.getMonth() + 1)).slice(-2);
      var dia = ("0" + d.getDate()).slice(-2);
      var iso = y + "-" + m + "-" + dia;
      var ehHoje = (i === 0);

      var blocosDia = ehHoje && estadoAtual.blocos.length ? estadoAtual.blocos : carregarBlocosLocais(iso);
      var total = blocosDia.length;
      var concl = blocosDia.filter(function(b) { return b.status === "concluido"; }).length;
      var pct = total > 0 ? Math.round((concl / total) * 100) : 0;

      var row = document.createElement("div");
      row.className = "glass-card p-3 rounded-xl border " + (ehHoje ? "border-brand-500/50 bg-slate-900/90" : "border-slate-800 bg-slate-900/50") + " flex items-center justify-between gap-3";
      row.innerHTML =
        "<div class=\"min-w-[85px]\">" +
          "<span class=\"text-xs font-bold text-white block\">" + diasSemanaNomes[d.getDay()] + " · " + dia + "/" + m + (ehHoje ? " (Hoje)" : "") + "</span>" +
          "<span class=\"text-[10px] text-slate-400\">" + concl + " de " + total + " blocos</span>" +
        "</div>" +
        "<div class=\"flex-1 h-2 bg-slate-800 rounded-full overflow-hidden\">" +
          "<div class=\"h-full bg-emerald-500\" style=\"width:" + pct + "%\"></div>" +
        "</div>" +
        "<span class=\"font-mono text-xs font-extrabold text-emerald-300 min-w-[38px] text-right\">" + pct + "%</span>";
      grid.append(row);
    }
    container.append(grid);
  }

  function renderizar(blocosEntrada, containerId) {
    var cId = containerId || "rotina-blocos-container";
    var container = document.getElementById(cId);
    if (!container) return;

    var lista = Array.isArray(blocosEntrada)
      ? blocosEntrada.map(normalizarBloco)
      : carregarBlocosLocais(estadoAtual.dataISO);

    estadoAtual.blocos = lista;
    renderizarHeaderContadores(lista);
    atualizarPainelAderencia();
    renderizarMetasDiarias();

    container.replaceChildren();

    if (estadoAtual.modoVisualizacao === "semana") {
      renderizarPanoramaSemanal(container);
      return;
    }

    var filtrados = lista.filter(function(b) {
      if (estadoAtual.filtroAtivo === "todos") return true;
      return b.categoria === estadoAtual.filtroAtivo;
    });

    if (estadoAtual.modoVisualizacao === "foco" && filtrados.length > 0) {
      var emFoco = filtrados.find(function(b) {
        return calcularEstadoTempoBloco(b).emAndamento && b.status !== "concluido" && b.status !== "pulado";
      }) || filtrados.find(function(b) {
        return b.status === "pendente" || b.status === "ativo";
      }) || filtrados[0];
      filtrados = emFoco ? [emFoco] : [];
    }

    if (filtrados.length === 0) {
      renderizarEmptyState(container);
    } else {
      filtrados.forEach(function(bloco) {
        container.append(criarCardBloco(bloco));
      });
    }

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      try {
        window.lucide.createIcons({ root: container });
      } catch (_) {}
    }

    if (estadoAtual.modoData === "hoje" && typeof setTimeout === "function") {
      setTimeout(function() {
        try {
          if (typeof container.querySelector === "function") {
            var cardFoco = container.querySelector("[id^=\"card-\"][class*=\"ring-1.5\"]") ||
                           container.querySelector("[id^=\"card-\"]:not([class*=\"opacity-80\"]):not([class*=\"opacity-60\"])");
            if (cardFoco && typeof cardFoco.scrollIntoView === "function") {
              cardFoco.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }
        } catch (_) {}
      }, 120);
    }
  }

  // ==========================================
  // Modos de Visualização & Modo Plantão Alto Contraste
  // ==========================================

  function alternarVisualizacao(modo) {
    var m = (modo === "foco" || modo === "semana") ? modo : "timeline";
    estadoAtual.modoVisualizacao = m;

    var mapBtns = [
      { id: "btn-view-timeline", chave: "timeline" },
      { id: "btn-view-foco", chave: "foco" },
      { id: "btn-view-semana", chave: "semana" }
    ];
    for (var i = 0; i < mapBtns.length; i++) {
      var el = document.getElementById(mapBtns[i].id);
      if (el) {
        if (mapBtns[i].chave === m) {
          el.className = "px-2.5 py-1 rounded-lg font-bold bg-brand-500/30 text-brand-200 border border-brand-500/40 transition";
        } else {
          el.className = "px-2.5 py-1 rounded-lg font-medium text-slate-400 hover:text-slate-200 transition";
        }
      }
    }
    renderizar(estadoAtual.blocos);
  }

  function alternarModoPlantaoAltoContraste(forcarEstado) {
    estadoAtual.modoPlantaoAltoContraste = typeof forcarEstado === "boolean"
      ? forcarEstado
      : !estadoAtual.modoPlantaoAltoContraste;

    var banner = document.getElementById("rotina-modo-plantao-banner");
    var btn = document.getElementById("btn-modo-plantao-ativo");

    if (banner && banner.classList) {
      if (estadoAtual.modoPlantaoAltoContraste) {
        banner.classList.remove("hidden");
      } else {
        banner.classList.add("hidden");
      }
    }

    if (btn) {
      btn.className = estadoAtual.modoPlantaoAltoContraste
        ? "min-h-[34px] px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold bg-emerald-500 text-slate-950 border border-emerald-300 transition active:scale-95 flex items-center gap-1 shadow-md"
        : "min-h-[34px] px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition active:scale-95 flex items-center gap-1";
    }

    dispararHaptic("sucesso");
  }

  // ==========================================
  // Criação, Edição e Exclusão Rápida de Blocos
  // ==========================================

  function salvarBlocoPersonalizado(dadosBloco) {
    if (!dadosBloco || !dadosBloco.titulo) return null;
    var lista = carregarBlocosLocais(estadoAtual.dataISO);
    var idAlvo = dadosBloco.id || ("bloco-" + Date.now());
    var normalizado = normalizarBloco({
      id: idAlvo,
      titulo: dadosBloco.titulo,
      inicio: dadosBloco.inicio || "08:00",
      fim: dadosBloco.fim || "09:00",
      categoria: dadosBloco.categoria || "estudo",
      status: dadosBloco.status || "pendente",
      nota: dadosBloco.nota || ""
    }, lista.length);

    var substituido = false;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === idAlvo) {
        lista[i] = normalizado;
        substituido = true;
        break;
      }
    }
    if (!substituido) {
      lista.push(normalizado);
    }

    lista.sort(function(a, b) {
      return converterHoraEmMinutos(a.inicio) - converterHoraEmMinutos(b.inicio);
    });

    salvarBlocosLocais(lista, estadoAtual.dataISO);
    renderizar(lista);
    dispararHaptic("sucesso");
    return normalizado;
  }

  function removerBloco(blocoId) {
    if (!blocoId) return;
    var lista = estadoAtual.blocos.filter(function(b) { return b.id !== blocoId; });
    salvarBlocosLocais(lista, estadoAtual.dataISO);
    renderizar(lista);
    dispararHaptic("aviso");
  }

  function abrirModalBloco(blocoId) {
    if (typeof document === "undefined" || !document.body || typeof document.body.append !== "function") return;
    var existente = document.getElementById("modal-editor-bloco-rotina");
    if (existente && typeof existente.remove === "function") existente.remove();

    var blocoEdit = null;
    if (blocoId) {
      for (var bIdx = 0; bIdx < estadoAtual.blocos.length; bIdx++) {
        if (estadoAtual.blocos[bIdx].id === blocoId) {
          blocoEdit = estadoAtual.blocos[bIdx];
          break;
        }
      }
    }

    var modal = document.createElement("div");
    modal.id = "modal-editor-bloco-rotina";
    modal.className = "fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4";

    var titVal = blocoEdit ? blocoEdit.titulo : "";
    var iniVal = blocoEdit ? blocoEdit.inicio : "19:00";
    var fimVal = blocoEdit ? blocoEdit.fim : "21:00";
    var catVal = blocoEdit ? blocoEdit.categoria : "estudo";
    var notaVal = blocoEdit ? blocoEdit.nota : "";

    modal.innerHTML =
      "<div class=\"glass-card w-full max-w-md p-4 rounded-2xl border border-slate-700 bg-slate-900 space-y-3 shadow-2xl\">" +
        "<div class=\"flex items-center justify-between\">" +
          "<h3 class=\"text-sm font-extrabold text-white\">" + (blocoEdit ? "Editar Bloco da Rotina" : "Novo Bloco Time-Blocking") + "</h3>" +
          "<button type=\"button\" id=\"btn-fechar-modal-bloco\" class=\"text-slate-400 hover:text-white text-xs font-bold px-2 py-1\">✕</button>" +
        "</div>" +
        "<div class=\"space-y-2 text-xs\">" +
          "<div>" +
            "<label class=\"text-[11px] text-slate-400 font-semibold block mb-1\">Título da Atividade</label>" +
            "<input id=\"inp-modal-bloco-titulo\" type=\"text\" value=\"" + titVal.replace(/"/g, "&quot;") + "\" placeholder=\"Ex: MedQuest Clínica Médica 40q\" class=\"w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none\" />" +
          "</div>" +
          "<div class=\"grid grid-cols-2 gap-2\">" +
            "<div>" +
              "<label class=\"text-[11px] text-slate-400 font-semibold block mb-1\">Início</label>" +
              "<input id=\"inp-modal-bloco-inicio\" type=\"time\" value=\"" + iniVal + "\" class=\"w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none\" />" +
            "</div>" +
            "<div>" +
              "<label class=\"text-[11px] text-slate-400 font-semibold block mb-1\">Fim</label>" +
              "<input id=\"inp-modal-bloco-fim\" type=\"time\" value=\"" + fimVal + "\" class=\"w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none\" />" +
            "</div>" +
          "</div>" +
          "<div>" +
            "<label class=\"text-[11px] text-slate-400 font-semibold block mb-1\">Eixo / Categoria</label>" +
            "<select id=\"inp-modal-bloco-cat\" class=\"w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none\">" +
              "<option value=\"estudo\"" + (catVal === "estudo" ? " selected" : "") + ">📚 MedQuest & Anki (Estudo)</option>" +
              "<option value=\"plantao\"" + (catVal === "plantao" ? " selected" : "") + ">🩺 Plantão / Internato</option>" +
              "<option value=\"treino\"" + (catVal === "treino" ? " selected" : "") + ">🏋️ Treino & Bio</option>" +
              "<option value=\"recuperacao\"" + (catVal === "recuperacao" ? " selected" : "") + ">🌙 Recuperação & Sono</option>" +
              "<option value=\"lifestyle\"" + (catVal === "lifestyle" ? " selected" : "") + ">🎸 Vida & Lifestyle</option>" +
              "<option value=\"compromisso\"" + (catVal === "compromisso" ? " selected" : "") + ">📅 Compromisso Geral</option>" +
            "</select>" +
          "</div>" +
          "<div>" +
            "<label class=\"text-[11px] text-slate-400 font-semibold block mb-1\">Meta / Instrução de Foco</label>" +
            "<input id=\"inp-modal-bloco-nota\" type=\"text\" value=\"" + notaVal.replace(/"/g, "&quot;") + "\" placeholder=\"Ex: Foco em Síndromes Coronarianas + Revisão Anki\" class=\"w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none\" />" +
          "</div>" +
        "</div>" +
        "<div class=\"flex items-center justify-between gap-2 pt-2 border-t border-slate-800\">" +
          (blocoEdit
            ? "<button type=\"button\" id=\"btn-excluir-modal-bloco\" class=\"px-3 py-2 rounded-xl bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold\">Excluir</button>"
            : "<span></span>") +
          "<div class=\"flex items-center gap-2\">" +
            "<button type=\"button\" id=\"btn-cancelar-modal-bloco\" class=\"px-3 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold\">Cancelar</button>" +
            "<button type=\"button\" id=\"btn-salvar-modal-bloco\" class=\"px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold\">Salvar Bloco</button>" +
          "</div>" +
        "</div>" +
      "</div>";

    document.body.append(modal);

    var fechar = function() {
      if (typeof modal.remove === "function") modal.remove();
    };

    var btnF = document.getElementById("btn-fechar-modal-bloco");
    var btnC = document.getElementById("btn-cancelar-modal-bloco");
    var btnS = document.getElementById("btn-salvar-modal-bloco");
    var btnE = document.getElementById("btn-excluir-modal-bloco");

    if (btnF) btnF.onclick = fechar;
    if (btnC) btnC.onclick = fechar;
    if (btnE && blocoEdit) {
      btnE.onclick = function() {
        removerBloco(blocoEdit.id);
        fechar();
      };
    }
    if (btnS) {
      btnS.onclick = function() {
        var t = (document.getElementById("inp-modal-bloco-titulo") || {}).value || "Bloco Programado";
        var i = (document.getElementById("inp-modal-bloco-inicio") || {}).value || "08:00";
        var f = (document.getElementById("inp-modal-bloco-fim") || {}).value || "09:00";
        var c = (document.getElementById("inp-modal-bloco-cat") || {}).value || "estudo";
        var n = (document.getElementById("inp-modal-bloco-nota") || {}).value || "";
        salvarBlocoPersonalizado({
          id: blocoEdit ? blocoEdit.id : null,
          titulo: t,
          inicio: i,
          fim: f,
          categoria: c,
          status: blocoEdit ? blocoEdit.status : "pendente",
          nota: n
        });
        fechar();
      };
    }
  }

  // ==========================================
  // Mutações de Status, Filtro e Grade Padrão
  // ==========================================

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

    dispararHaptic(novoStatus === "concluido" ? "sucesso" : (novoStatus === "pulado" ? "aviso" : "light"));
    salvarBlocosLocais(estadoAtual.blocos);
    renderizar(estadoAtual.blocos);
    sincronizarStatusComBackend(blocoId, novoStatus, nota);
  }

  function ativarModoDescanso() {
    var alterado = false;
    for (var i = 0; i < estadoAtual.blocos.length; i++) {
      var cat = estadoAtual.blocos[i].categoria;
      if (cat === "treino" || cat === "estudo") {
        estadoAtual.blocos[i].status = "descanso";
        estadoAtual.blocos[i].nota = "Descanso biológico e recuperação ativados pelo Dr. Wagner";
        alterado = true;
      }
    }
    if (alterado) {
      salvarBlocosLocais(estadoAtual.blocos);
      renderizar(estadoAtual.blocos);
      if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
        window.copiarToast("🌿 Modo Descanso ativado para os blocos de treino e estudo!");
      }
    }
  }

  function aplicarFiltro(categoria) {
    estadoAtual.filtroAtivo = categoria || "todos";

    var botoes = document.querySelectorAll(".btn-filtro-rotina");
    botoes.forEach(function(btn) {
      var cat = btn.getAttribute("data-filtro") || "todos";
      if (cat === estadoAtual.filtroAtivo) {
        btn.className = "btn-filtro-rotina min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-500/20 text-brand-300 border border-brand-500/40 transition active:scale-95 shadow-sm shrink-0";
      } else {
        btn.className = "btn-filtro-rotina min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:text-white transition active:scale-95 shrink-0";
      }
    });

    renderizar(estadoAtual.blocos);
  }

  function carregarGradePadrao() {
    var hoje = new Date();
    var diaSem = hoje.getDay();
    var ehFimDeSemana = (diaSem === 0 || diaSem === 6);

    var gradePadrao = [
      {
        id: "bloco-manha",
        titulo: ehFimDeSemana ? "Simulado & Revisão MedQuest R1" : "Plantão & Rodízio Hospitalar",
        inicio: "07:00",
        fim: "13:00",
        categoria: ehFimDeSemana ? "estudo" : "plantao",
        status: "pendente",
        nota: ehFimDeSemana ? "Bloco 1: 50 questões comentadas no MedQuest" : "Enfermaria Geral · Passagem de Plantão SBAR"
      },
      {
        id: "bloco-tarde",
        titulo: "Ambulatório & Condutas Específicas",
        inicio: "13:30",
        fim: "17:30",
        categoria: "plantao",
        status: "pendente",
        nota: "Atendimento clínico com registro ágil via /soap e /rx"
      },
      {
        id: "bloco-treino",
        titulo: "Treino Musculação & Cardio",
        inicio: "18:00",
        fim: "19:15",
        categoria: "treino",
        status: "pendente",
        nota: "Protocolo Cutting Natural + Hidratação 1L intra-treino"
      },
      {
        id: "bloco-noite",
        titulo: "MedQuest & Revisão de Flashcards Anki",
        inicio: "20:30",
        fim: "22:30",
        categoria: "estudo",
        status: "pendente",
        nota: "Foco da noite: 30 questões + Caderno de Erros R1"
      }
    ];

    salvarBlocosLocais(gradePadrao);
    renderizar(gradePadrao);
    if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
      window.copiarToast("✨ Grade diária padrão carregada com sucesso!");
    }
  }

  function carregarGradePadraoComConfirmacao() {
    var confirmou = false;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      confirmou = window.confirm("Deseja realmente carregar a grade diária padrão fixa?\n\nIsso irá substituir os blocos do dia atual no Cockpit.");
    } else {
      confirmou = true;
    }
    if (confirmou) {
      carregarGradePadrao();
    }
  }

  // ==========================================
  // Persistência Offline-First (IndexedDB + Fila)
  // ==========================================

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
      var alvoData = dataISO || estadoAtual.dataISO || obterDataISO("hoje");
      var chaveData = STORAGE_KEY + "_" + alvoData;

      if (typeof window !== "undefined" && window.localDb && typeof window.localDb.table === "function") {
        try {
          window.localDb.table("snapshots").put({
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
      var alvoData = dataISO || estadoAtual.dataISO || obterDataISO("hoje");
      var chaveData = STORAGE_KEY + "_" + alvoData;

      if (typeof window !== "undefined" && window.localDb && typeof window.localDb.table === "function") {
        try {
          window.localDb.table("snapshots").get(chaveData).then(function(item) {
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
      var fila = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      fila.push({
        blocoId: blocoId,
        status: status,
        nota: nota || "",
        timestamp: Date.now()
      });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(fila));
      atualizarBadgeSync("Salvo offline (" + fila.length + " pendente" + (fila.length > 1 ? "s" : "") + ")", false);

      if (typeof window !== "undefined" && window.localDb && typeof window.localDb.table === "function") {
        try {
          window.localDb.table("syncQueue").add({
            acao: "rotina_status",
            payload: JSON.stringify({ blocoId: blocoId, status: status, nota: nota }),
            status: "pendente",
            criadoEm: Date.now()
          }).catch(function() {});
        } catch (_) {}
      }
    } catch (_) {}
  }

  function processarFilaOffline() {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (filaProcessando) return;
    try {
      var raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return;
      var fila = JSON.parse(raw);
      if (!Array.isArray(fila) || fila.length === 0) return;

      filaProcessando = true;
      var endpoint = obterApiBaseUrl() + "/api/rotina/status";
      var item = fila[0];

      if (typeof fetch !== "function") {
        filaProcessando = false;
        return;
      }

      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item)
      }).then(function(res) {
        filaProcessando = false;
        if (res.ok) {
          var filaAtual = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
          filaAtual.shift();
          localStorage.setItem(QUEUE_KEY, JSON.stringify(filaAtual));
          if (filaAtual.length > 0) {
            processarFilaOffline();
          } else {
            atualizarBadgeSync("Sincronizado", true);
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
        b.status = "adiado";
        b.nota = (b.nota ? b.nota + " · " : "") + "Adiado em " + minAdd + "m";
        blocoModificado = b;
        break;
      }
    }
    if (blocoModificado) {
      salvarBlocosLocais(estadoAtual.blocos);
      renderizar(estadoAtual.blocos);
      sincronizarStatusComBackend(blocoModificado.id, "adiado", blocoModificado.nota);
      if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
        window.copiarToast("⏰ Bloco adiado para " + blocoModificado.inicio + " - " + blocoModificado.fim);
      }
    }
  }

  function sincronizarStatusComBackend(blocoId, status, nota) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enfileirarMutacaoOffline(blocoId, status, nota);
      return;
    }
    try {
      var endpoint = obterApiBaseUrl() + "/api/rotina/status";
      if (typeof fetch !== "function") {
        enfileirarMutacaoOffline(blocoId, status, nota);
        return;
      }
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocoId: blocoId, status: status, nota: nota })
      }).then(function(res) {
        if (res.ok) {
          atualizarBadgeSync("Sincronizado", true);
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
    var novoModo = (modo === "amanha") ? "amanha" : "hoje";
    estadoAtual.modoData = novoModo;
    estadoAtual.dataISO = obterDataISO(novoModo);

    var btnHoje = document.getElementById("btn-rotina-data-hoje");
    var btnAmanha = document.getElementById("btn-rotina-data-amanha");
    var labelProgresso = document.getElementById("rotina-label-progresso");

    if (btnHoje && btnAmanha) {
      if (novoModo === "hoje") {
        btnHoje.className = "py-1.5 px-3 rounded-lg font-bold bg-brand-500/20 text-brand-300 border border-brand-500/40 transition flex items-center justify-center gap-1.5";
        btnAmanha.className = "py-1.5 px-3 rounded-lg font-medium bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200 transition flex items-center justify-center gap-1.5";
      } else {
        btnAmanha.className = "py-1.5 px-3 rounded-lg font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40 transition flex items-center justify-center gap-1.5";
        btnHoje.className = "py-1.5 px-3 rounded-lg font-medium bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200 transition flex items-center justify-center gap-1.5";
      }
    }

    if (labelProgresso) {
      labelProgresso.textContent = novoModo === "hoje" ? "Progresso dos Blocos de Hoje" : "Compromissos e Estudos de Amanhã";
    }

    var blocosLocais = carregarBlocosLocais(estadoAtual.dataISO);
    renderizar(blocosLocais);
    carregarBlocosDoServidor(estadoAtual.dataISO);
  }

  function mesclarComFilaOffline(blocosServidor) {
    var raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return blocosServidor;
    var fila = [];
    try { fila = JSON.parse(raw); } catch (_) { return blocosServidor; }
    if (!Array.isArray(fila) || !fila.length) return blocosServidor;

    var mapaMutacoes = {};
    for (var i = 0; i < fila.length; i++) {
      if (fila[i] && fila[i].blocoId) {
        mapaMutacoes[fila[i].blocoId] = fila[i];
      }
    }

    return (blocosServidor || []).map(function(b) {
      var mut = mapaMutacoes[b.id];
      if (mut) {
        if (mut.status) b.status = mut.status;
        if (mut.nota) b.nota = mut.nota;
        if (mut.inicio) b.inicio = mut.inicio;
        if (mut.fim) b.fim = mut.fim;
      }
      return b;
    });
  }

  function carregarBlocosDoServidor(dataISO, callback) {
    if (typeof dataISO === "function") {
      callback = dataISO;
      dataISO = null;
    }
    var targetDateISO = dataISO || estadoAtual.dataISO || obterDataISO("hoje");
    estadoAtual.dataISO = targetDateISO;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (typeof callback === "function") callback(null);
      return;
    }
    try {
      var endpoint = obterApiBaseUrl() + "/api/rotina/blocos?data=" + encodeURIComponent(targetDateISO);
      if (typeof fetch !== "function") {
        if (typeof callback === "function") callback(null);
        return;
      }
      fetch(endpoint).then(function(res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        if (typeof res.json !== "function") return null;
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && Array.isArray(data.blocos)) {
          var blocosConciliados = mesclarComFilaOffline(data.blocos);
          salvarBlocosLocais(blocosConciliados, targetDateISO);
          renderizar(blocosConciliados);
          atualizarBadgeSync("Google Calendar", true);
        }
        processarFilaOffline();
        if (typeof callback === "function") callback(data);
      }).catch(function(err) {
        console.warn("[RotinaTimeline] Erro ao carregar blocos do servidor:", err);
        if (typeof callback === "function") callback(null);
      });
    } catch (e) {
      if (typeof callback === "function") callback(null);
    }
  }

  function sincronizarAgendaGoogle(callback) {
    var targetDateISO = estadoAtual.dataISO || obterDataISO("hoje");
    atualizarBadgeSync("Sincronizando...", false);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      atualizarBadgeSync("Offline", false);
      if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
        window.copiarToast("⚠️ Sem conexão para sincronizar com Google Calendar.");
      }
      if (typeof callback === "function") callback(null);
      return;
    }

    try {
      var endpoint = obterApiBaseUrl() + "/api/rotina/agenda/sync";
      if (typeof fetch !== "function") {
        if (typeof callback === "function") callback(null);
        return;
      }
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: targetDateISO })
      }).then(function(res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && Array.isArray(data.blocos)) {
          salvarBlocosLocais(data.blocos, targetDateISO);
          renderizar(data.blocos);
          atualizarBadgeSync("Google Calendar", true);
          if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
            window.copiarToast("📅 Sincronizado com o Google Calendar do Dr. Wagner (" + data.blocos.length + " blocos)!");
          }
        }
        processarFilaOffline();
        if (typeof callback === "function") callback(data);
      }).catch(function(err) {
        console.warn("[RotinaTimeline] Falha na sincronização da agenda:", err);
        atualizarBadgeSync("Salvo offline", false);
        if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
          window.copiarToast("⚠️ Erro ao sincronizar com Google Calendar: " + err.message);
        }
        if (typeof callback === "function") callback(null);
      });
    } catch (e) {
      atualizarBadgeSync("Salvo offline", false);
      if (typeof callback === "function") callback(null);
    }
  }

  // ==========================================
  // Gaveta de Dúvidas MedQuest & Residência (com 5 Grandes Áreas R1)
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

  function selecionarAreaDuvida(area) {
    if (area) estadoAtual.areaDuvidaSelecionada = area;
    var botoes = document.querySelectorAll(".btn-area-duvida");
    botoes.forEach(function(btn) {
      var a = btn.getAttribute("data-area");
      if (a === estadoAtual.areaDuvidaSelecionada) {
        btn.className = "btn-area-duvida px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/30 text-purple-200 border border-purple-500/50";
      } else {
        btn.className = "btn-area-duvida px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700";
      }
    });
  }

  function renderizarDuvidas(duvidasEntrada) {
    var container = document.getElementById("rotina-duvidas-lista");
    var badgeContador = document.getElementById("duvidas-contador-badge");
    var duvidas = Array.isArray(duvidasEntrada) ? duvidasEntrada : carregarDuvidasLocais();

    var pendentes = duvidas.filter(function(d) { return !d.resolvida; });
    if (badgeContador) {
      badgeContador.textContent = String(pendentes.length);
      if (pendentes.length > 0) {
        badgeContador.className = "text-[9.5px] px-1.5 py-0.2 rounded-full font-bold bg-purple-500/30 text-purple-200 border border-purple-500/40";
      } else {
        badgeContador.className = "text-[9.5px] px-1.5 py-0.2 rounded-full font-bold bg-slate-800 text-slate-400 border border-slate-700";
      }
    }

    if (!container) return;
    container.replaceChildren();

    if (duvidas.length === 0) {
      var vazio = document.createElement("div");
      vazio.className = "text-[11px] text-slate-400 text-center py-2.5 italic";
      vazio.textContent = "Nenhuma dúvida anotada. Registre temas de questões ou plantão para revisar!";
      container.append(vazio);
      return;
    }

    duvidas.forEach(function(item) {
      var row = document.createElement("div");
      row.className = "flex items-center justify-between gap-2 p-2 rounded-xl transition " +
        (item.resolvida
          ? "bg-slate-900/40 border border-slate-800 text-slate-500"
          : "bg-slate-900/80 border border-purple-500/20 text-slate-200 hover:border-purple-500/40");

      var corpo = document.createElement("div");
      corpo.className = "flex-1 min-w-0 flex items-start gap-2";

      var bullet = document.createElement("span");
      bullet.className = "mt-1 w-1.5 h-1.5 rounded-full shrink-0 " + (item.resolvida ? "bg-slate-600" : "bg-purple-400");

      var wrapTexto = document.createElement("div");
      wrapTexto.className = "flex-1 min-w-0 space-y-0.5";

      if (item.area) {
        var areaBadge = document.createElement("span");
        areaBadge.className = "inline-block text-[9px] font-bold px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 mr-1";
        areaBadge.textContent = item.area;
        wrapTexto.append(areaBadge);
      }

      var texto = document.createElement("span");
      texto.className = "text-[11.5px] leading-tight break-words " + (item.resolvida ? "line-through text-slate-500" : "text-slate-100 font-medium");
      texto.textContent = item.texto || item.duvida || "Sem texto";

      wrapTexto.append(texto);
      corpo.append(bullet, wrapTexto);

      var btnCheck = document.createElement("button");
      btnCheck.type = "button";
      btnCheck.className = "min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-bold shrink-0 transition active:scale-95 flex items-center gap-1.5 shadow-sm " +
        (item.resolvida
          ? "bg-slate-800 text-slate-400 hover:text-slate-300 border border-slate-700/60"
          : "bg-purple-500/20 hover:bg-emerald-500/20 text-purple-200 hover:text-emerald-300 border border-purple-500/35 hover:border-emerald-500/40");
      btnCheck.innerHTML = item.resolvida
        ? "<i data-lucide=\"check\" class=\"w-3.5 h-3.5 text-emerald-400\"></i> Revisada"
        : "<i data-lucide=\"check\" class=\"w-3.5 h-3.5\"></i> Concluir";

      btnCheck.onclick = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        resolverDuvidaCockpit(item.id);
      };

      row.append(corpo, btnCheck);
      container.append(row);
    });

    if (window.lucide && typeof window.lucide.createIcons === "function") {
      try {
        window.lucide.createIcons({ root: container });
      } catch (_) {}
    }
  }

  function carregarDuvidasDoServidor(callback) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      var locais = carregarDuvidasLocais();
      renderizarDuvidas(locais);
      if (typeof callback === "function") callback(locais);
      return;
    }
    try {
      var endpoint = obterApiBaseUrl() + "/api/rotina/duvidas";
      if (typeof fetch !== "function") {
        var locaisF = carregarDuvidasLocais();
        renderizarDuvidas(locaisF);
        if (typeof callback === "function") callback(locaisF);
        return;
      }
      fetch(endpoint).then(function(res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        if (typeof res.json !== "function") return null;
        return res.json();
      }).then(function(data) {
        if (data && data.sucesso && Array.isArray(data.duvidas)) {
          var locais = carregarDuvidasLocais();
          var idsServidor = {};
          data.duvidas.forEach(function(d) { idsServidor[d.id] = true; });

          var naoSincronizadas = locais.filter(function(d) {
            return String(d.id).indexOf("duv_") === 0 && !idsServidor[d.id];
          });

          var listaFinal = naoSincronizadas.concat(data.duvidas);
          salvarDuvidasLocais(listaFinal);
          renderizarDuvidas(listaFinal);
        }
        if (typeof callback === "function") callback(data);
      }).catch(function(err) {
        console.warn("[RotinaTimeline] Erro ao buscar dúvidas do servidor:", err);
        var locais = carregarDuvidasLocais();
        renderizarDuvidas(locais);
        if (typeof callback === "function") callback(null);
      });
    } catch (_) {
      if (typeof callback === "function") callback(null);
    }
  }

  function adicionarDuvidaCockpit() {
    var input = document.getElementById("input-nova-duvida-cockpit");
    if (!input) return;
    var texto = (input.value || "").trim();
    if (!texto) return;

    input.value = "";

    var tempId = "duv_" + Date.now();
    var novaDuvida = {
      id: tempId,
      texto: texto,
      area: estadoAtual.areaDuvidaSelecionada || "Clínica",
      resolvida: false,
      origem: "cockpit",
      dataCriacao: new Date().toISOString()
    };

    var lista = carregarDuvidasLocais();
    lista.unshift(novaDuvida);
    salvarDuvidasLocais(lista);
    renderizarDuvidas(lista);
    dispararHaptic("sucesso");

    if (typeof window !== "undefined" && typeof window.copiarToast === "function") {
      window.copiarToast("💡 Dúvida anotada em " + novaDuvida.area + "! Disponível no Cockpit e no Telegram.");
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (typeof fetch !== "function") return;

    try {
      var endpoint = obterApiBaseUrl() + "/api/rotina/duvidas";
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: texto, area: novaDuvida.area, origem: "cockpit" })
      }).then(function(res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
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
        console.warn("[RotinaTimeline] Erro ao sincronizar nova dúvida com servidor:", err);
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

    dispararHaptic(encontrada && encontrada.resolvida ? "sucesso" : "light");

    if (encontrada && encontrada.resolvida && typeof window !== "undefined" && typeof window.copiarToast === "function") {
      window.copiarToast("✅ Dúvida marcada como revisada!");
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (typeof fetch !== "function") return;

    try {
      var endpoint = obterApiBaseUrl() + "/api/rotina/duvidas/resolver";
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id })
      }).catch(function(err) {
        console.warn("[RotinaTimeline] Erro ao sincronizar resolução no servidor:", err);
      });
    } catch (_) {}
  }

  function alternarGavetaDuvidas() {
    var conteudo = document.getElementById("rotina-duvidas-conteudo");
    var icone = document.getElementById("icone-toggle-duvidas");
    if (!conteudo) return;

    var estaOculto = conteudo.classList && conteudo.classList.contains("hidden");
    if (estaOculto) {
      conteudo.classList.remove("hidden");
      if (icone && icone.style) icone.style.transform = "rotate(0deg)";
    } else if (conteudo.classList) {
      conteudo.classList.add("hidden");
      if (icone && icone.style) icone.style.transform = "rotate(-90deg)";
    }
  }

  // ==========================================
  // Auto-Sincronização em Tempo Real (Polling Suave)
  // ==========================================

  var POLLING_INTERVALO_MS = 30000;
  var timerPolling = null;

  function iniciarPollingSuave() {
    if (typeof setInterval !== "function") return;
    if (timerPolling) return;

    timerPolling = setInterval(function() {
      try {
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        if (typeof document !== "undefined") {
          if (document.hidden) return;
          var tabRotina = document.getElementById("tab-rotina");
          if (tabRotina && tabRotina.classList && tabRotina.classList.contains("hidden")) return;
        }

        carregarBlocosDoServidor(estadoAtual.dataISO);
        carregarDuvidasDoServidor();
        atualizarRadarAgoraVivo();
      } catch (_) {}
    }, POLLING_INTERVALO_MS);
  }

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("online", function() {
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
    selecionarAreaDuvida: selecionarAreaDuvida,
    iniciarPollingSuave: iniciarPollingSuave,
    salvarBlocosOfflineAsync: salvarBlocosOfflineAsync,
    carregarBlocosOfflineAsync: carregarBlocosOfflineAsync,
    obterFilaOffline: obterFilaOffline,
    obterStatusFilaOffline: obterStatusFilaOffline,
    enfileirarMutacaoOffline: enfileirarMutacaoOffline,
    calcularAderenciaSemanalLocal: calcularAderenciaSemanalLocal,
    atualizarPainelAderencia: atualizarPainelAderencia,
    atualizarRadarAgoraVivo: atualizarRadarAgoraVivo,
    alternarVisualizacao: alternarVisualizacao,
    alternarModoPlantaoAltoContraste: alternarModoPlantaoAltoContraste,
    abrirModalBloco: abrirModalBloco,
    salvarBlocoPersonalizado: salvarBlocoPersonalizado,
    removerBloco: removerBloco,
    iniciarPomodoroBloco: iniciarPomodoroBloco,
    resetarPomodoroBloco: resetarPomodoroBloco,
    carregarMetasDiarias: carregarMetasDiarias,
    salvarMetasDiarias: salvarMetasDiarias,
    renderizarMetasDiarias: renderizarMetasDiarias,
    incrementarMetaDiaria: incrementarMetaDiaria,
    CATEGORIA_CONFIG: CATEGORIA_CONFIG,
    STATUS_CONFIG: STATUS_CONFIG,
    GRANDES_AREAS_R1: GRANDES_AREAS_R1
  };

  if (typeof window !== "undefined" && typeof setTimeout === "function") {
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

})(typeof window !== "undefined" ? window : this);
