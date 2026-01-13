import React, { useState } from 'react';
import { Header } from './components/Header';
import { EventCard } from './components/EventCard';
import { fetchEventsFromSource } from './services/api';
import { B2BEvent, AppStep } from './types';
import { Search, Loader2, FileText, Download, ArrowLeft, RefreshCw, CheckCircle2, XCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Lista Centralizada de Fontes
const SOURCES = [
  {
    id: 'google_search',
    name: 'Google Search (Varredura)',
    url: 'eventos de negócios networking campinas palestras workshops',
    mode: 'search' as const
  },
  { id: 'sympla_palestras', name: 'Sympla (Palestras)', url: 'https://www.sympla.com.br/eventos/campinas-sp/congressos-e-palestras', mode: 'scrape' as const },
  { id: 'sympla_network', name: 'Sympla (Networking)', url: 'https://www.sympla.com.br/eventos/campinas-sp?s=networking', mode: 'scrape' as const },
  { id: 'eventbrite', name: 'Eventbrite', url: 'https://www.eventbrite.com.br/d/brazil--campinas/business--events/', mode: 'scrape' as const },
  { id: 'meetup', name: 'Meetup', url: 'https://www.meetup.com/find/?location=br--Campinas&source=EVENTS&categoryId=career-business', mode: 'scrape' as const },
  { id: 'ciesp', name: 'CIESP', url: 'http://www.ciespcampinas.org.br/eventos/', mode: 'scrape' as const },
  { id: 'acic', name: 'ACIC', url: 'https://acicampinas.com.br/eventos/', mode: 'scrape' as const },
  { id: 'campinastech', name: 'Campinas Tech', url: 'https://campinastech.com.br/eventos/', mode: 'scrape' as const },
  { id: 'hora', name: 'Notícias (Hora Campinas)', url: 'https://horacampinas.com.br/categoria/economia/', mode: 'scrape' as const }
];

interface SourceStatus {
  id: string;
  name: string;
  status: 'pending' | 'loading' | 'completed' | 'error';
  count: number;
}

function App() {
  const [step, setStep] = useState<AppStep>('home');
  const [events, setEvents] = useState<B2BEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceStatuses, setSourceStatuses] = useState<SourceStatus[]>(
    SOURCES.map(s => ({ id: s.id, name: s.name, status: 'pending', count: 0 }))
  );
  const [warnings, setWarnings] = useState<string[]>([]);

  // Função auxiliar para processar em lotes (Concurrency Control)
  const processSourcesInBatches = async (sources: typeof SOURCES, concurrency: number) => {
    const queue = [...sources];
    const activePromises: Promise<void>[] = [];

    const processNext = async () => {
      if (queue.length === 0) return;

      const source = queue.shift()!;

      setSourceStatuses(prev => prev.map(s => s.id === source.id ? { ...s, status: 'loading' } : s));

      try {
        const { events: foundEvents, warning, error } = await fetchEventsFromSource(source.name, source.url, source.mode);

        if (warning) {
          setWarnings(prev => Array.from(new Set([...prev, `${source.name}: ${warning}`])));
        }

        if (error) {
          throw new Error(error);
        }

        setEvents(prev => {
          const newEvents = foundEvents.filter(ne =>
            !prev.some(pe => pe.title.toLowerCase().includes(ne.title.toLowerCase().slice(0, 15)))
          );
          return [...prev, ...newEvents];
        });

        setSourceStatuses(prev => prev.map(s =>
          s.id === source.id ? { ...s, status: 'completed', count: foundEvents.length } : s
        ));
      } catch (error) {
        setSourceStatuses(prev => prev.map(s =>
          s.id === source.id ? { ...s, status: 'error', count: 0 } : s
        ));
      }

      if (queue.length > 0) {
        await processNext();
      }
    };

    for (let i = 0; i < concurrency; i++) {
      activePromises.push(processNext());
    }

    await Promise.all(activePromises);
  };

  const handleSearch = async () => {
    setLoading(true);
    setStep('loading');
    setEvents([]);
    setWarnings([]);
    setSourceStatuses(SOURCES.map(s => ({ id: s.id, name: s.name, status: 'pending', count: 0 })));

    await processSourcesInBatches(SOURCES, 3);

    setLoading(false);
    // Se o usuário já não tiver clicado no botão manual, avança
    setStep((current) => current === 'loading' ? 'curation' : current);
  };

  const handleManualFinish = () => {
    setLoading(false);
    setStep('curation');
  };

  const handleRemoveEvent = (indexToRemove: number) => {
    setEvents(events.filter((_, index) => index !== indexToRemove));
  };

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(18);
    doc.text('Relatório de Prospecção de Eventos - Campinas/SP', 14, 20);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, 14, 26);

    autoTable(doc, {
      startY: 32,
      head: [['Data', 'Evento', 'Local', 'Link', 'Oportunidade']],
      body: events.map(e => [e.date, e.title, e.location, e.link, e.opportunity]),
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 9, cellPadding: 4 },
    });
    doc.save('relatorio-eventos-b2b.pdf');
  };

  const totalEvents = events.length;
  const completedCount = sourceStatuses.filter(s => s.status === 'completed' || s.status === 'error').length;
  const totalSources = SOURCES.length;
  const progressPercent = Math.round((completedCount / totalSources) * 100);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Header />

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">

        {step === 'home' && (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-8 animate-fade-in-up">
            <div className="max-w-2xl space-y-4">
              <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight sm:text-5xl">
                Encontre oportunidades de negócios.
              </h2>
              <p className="text-lg text-slate-600">
                O sistema varre a web (Google + 8 Fontes) em paralelo para encontrar networking qualificado em Campinas.
              </p>
            </div>

            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-8 py-4 text-lg font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-lg transform hover:-translate-y-1 transition-all flex items-center disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <Search className="mr-2 h-6 w-6" />
              Iniciar Varredura
            </button>

            <div className="flex flex-wrap justify-center gap-2 mt-8 max-w-4xl opacity-80">
              {SOURCES.map(s => (
                <span key={s.id} className="text-[10px] uppercase font-bold tracking-wider text-slate-400 bg-white px-2 py-1 rounded border border-slate-200">
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {step === 'loading' && (
          <div className="max-w-xl mx-auto mt-10">
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-slate-900 flex items-center justify-center">
                <Loader2 className="animate-spin mr-2 h-6 w-6 text-blue-600" />
                Analisando Fontes ({progressPercent}%)
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Isso pode levar até 1 minuto. Se demorar, clique em "Ver Resultados".
              </p>
            </div>

            <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden mb-6">
              <div className="divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">
                {sourceStatuses.map((source) => (
                  <div key={source.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center space-x-3">
                      {source.status === 'loading' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
                      {source.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                      {source.status === 'error' && <XCircle className="h-4 w-4 text-red-400" />}
                      {source.status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-slate-200" />}

                      <span className={`text-sm font-medium ${source.status === 'loading' ? 'text-blue-700' : source.status === 'pending' ? 'text-slate-400' : 'text-slate-700'}`}>
                        {source.name}
                      </span>
                    </div>
                    <div className="text-xs font-semibold">
                      {source.status === 'pending' && <span className="text-slate-300">Aguardando...</span>}
                      {source.status === 'loading' && <span className="text-blue-500">Processando...</span>}
                      {source.status === 'completed' && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">+{source.count}</span>}
                      {source.status === 'error' && <span className="text-red-400">Falha/Timeout</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-between items-center text-sm">
                <span className="text-slate-500">Eventos encontrados:</span>
                <strong className="text-2xl text-blue-600">{events.length}</strong>
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <h4 className="text-sm font-bold text-amber-800 flex items-center mb-2">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Avisos do Sistema
                </h4>
                <ul className="list-disc list-inside text-xs text-amber-700 space-y-1">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <div className="text-center">
              <button
                onClick={handleManualFinish}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                Ver Resultados Parciais agora
                <ArrowRight className="ml-2 h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {(step === 'curation' || step === 'report') && (
          <div className="space-y-8 animate-fade-in">
            {step === 'curation' && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Resultados da Varredura</h2>
                    <p className="text-slate-500">
                      {totalEvents > 0 ? `Encontramos ${totalEvents} oportunidades.` : 'Nenhum evento encontrado.'}
                    </p>
                  </div>
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('home')}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center"
                  >
                    <RefreshCw size={16} className="mr-2" />
                    Nova Busca
                  </button>
                  <button
                    onClick={() => setStep('report')}
                    disabled={totalEvents === 0}
                    className="px-4 py-2 text-sm font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 shadow-sm flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FileText size={16} className="mr-2" />
                    Gerar Relatório
                  </button>
                </div>
              </div>
            )}

            {step === 'report' && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <button
                  onClick={() => setStep('curation')}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 flex items-center"
                >
                  <ArrowLeft size={16} className="mr-2" />
                  Voltar
                </button>
                <button
                  onClick={handleExportPDF}
                  className="px-6 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-md flex items-center"
                >
                  <Download size={18} className="mr-2" />
                  Baixar PDF
                </button>
              </div>
            )}

            {step === 'curation' && events.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-slate-200 border-dashed flex flex-col items-center">
                <AlertTriangle className="h-10 w-10 text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-900">Nada encontrado desta vez</h3>
                <p className="text-slate-500 max-w-sm mx-auto mt-2 mb-6">
                  Houve muitos timeouts ou não há eventos na agenda. Verifique sua conexão ou tente novamente.
                </p>
                <button
                  onClick={() => setStep('home')}
                  className="px-4 py-2 bg-blue-50 text-blue-600 font-medium rounded-lg hover:bg-blue-100 transition-colors"
                >
                  Tentar novamente
                </button>
              </div>
            ) : step === 'curation' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {events.map((event, index) => (
                  <div key={`${event.title}-${index}`} className="animate-fade-in-up" style={{ animationDelay: `${index * 50}ms` }}>
                    <EventCard
                      event={event}
                      onRemove={() => handleRemoveEvent(index)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                  <h3 className="text-lg font-bold text-slate-900">Pré-visualização</h3>
                  <p className="text-2xl font-bold text-blue-600">{events.length}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-600">
                    <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 w-32">Data</th>
                        <th className="px-6 py-4">Evento</th>
                        <th className="px-6 py-4">Local</th>
                        <th className="px-6 py-4">Link</th>
                        <th className="px-6 py-4 w-1/4">Estratégia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {events.map((event, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-medium text-slate-900 whitespace-nowrap">{event.date}</td>
                          <td className="px-6 py-4 font-semibold text-slate-800">{event.title}</td>
                          <td className="px-6 py-4">{event.location}</td>
                          <td className="px-6 py-4">
                            <a href={event.link} target="_blank" className="text-blue-600 hover:underline truncate block max-w-[200px]">
                              Inscrição
                            </a>
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              {event.opportunity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translate3d(0, 20px, 0); } to { opacity: 1; transform: none; } }
        .animate-fade-in-up { animation: fadeInUp 0.5s ease-out forwards; }
      `}</style>
    </div>
  );
}

export default App;