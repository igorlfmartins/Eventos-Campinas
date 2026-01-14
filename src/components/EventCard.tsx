import React from 'react';
import { Calendar, MapPin, ExternalLink, Trash2, Lightbulb, Target } from 'lucide-react';
import { B2BEvent } from '../types';

interface EventCardProps {
  event: B2BEvent;
  onRemove: () => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, onRemove }) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow p-5 flex flex-col h-full relative group">

      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-bold text-slate-800 leading-tight pr-8">{event.title}</h3>
        <button
          onClick={onRemove}
          className="text-slate-400 hover:text-red-500 transition-colors p-1 absolute top-4 right-4"
          title="Remover evento"
        >
          <Trash2 size={18} />
        </button>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center text-sm text-slate-600">
          <Calendar size={16} className="mr-2 text-blue-500" />
          <span className="font-medium">{event.date}</span>
        </div>
        <div className="flex items-center text-sm text-slate-600">
          <MapPin size={16} className="mr-2 text-blue-500" />
          <span className="truncate" title={event.location}>{event.location}</span>
        </div>
        <a
          href={event.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center text-sm text-blue-600 hover:underline w-fit"
        >
          <ExternalLink size={16} className="mr-2" />
          Ver página de inscrição
        </a>
      </div>

      <div className="mt-auto space-y-3 pt-4 border-t border-slate-100">
        <div className="bg-slate-50 p-3 rounded-lg">
          <div className="flex items-start">
            <Lightbulb size={16} className="text-amber-500 mt-0.5 mr-2 shrink-0" />
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-900 block mb-1">Por que ir?</span>
              {event.analysis}
            </p>
          </div>
        </div>

        <div className="bg-blue-50 p-3 rounded-lg">
          <div className="flex items-start">
            <Target size={16} className="text-blue-600 mt-0.5 mr-2 shrink-0" />
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-900 block mb-1">Oportunidade:</span>
              {event.opportunity}
            </p>
          </div>
        </div>

        <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
          <div className="flex items-start">
            <span className="text-indigo-600 mt-0.5 mr-2 shrink-0">🛡️</span>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-semibold text-indigo-900 block mb-1">Relevância Seguros:</span>
              {event.insuranceRelevance}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};