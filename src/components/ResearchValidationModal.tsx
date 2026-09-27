import React, { useState } from 'react';
import {
  SlidersHorizontal,
  Cpu,
  Terminal,
  X,
  FlaskConical,
} from 'lucide-react';
import { BaselineComparison } from './BaselineComparison';
import { LiveFirmsAndTesting } from './LiveFirmsAndTesting';
import { Facility, ThermalEvent } from '../types';

interface ResearchValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  facilities: Facility[];
  onAddEvent?: (newEvent: ThermalEvent) => void;
  onBulkAddEvents?: (newEvents: ThermalEvent[]) => void;
  onNavigateToInvestigation?: (caseId: string) => void;
  initialTab?: 'comparison' | 'testing' | 'checklist';
}

export const ResearchValidationModal: React.FC<ResearchValidationModalProps> = ({
  isOpen,
  onClose,
  facilities,
  onAddEvent,
  onBulkAddEvents,
  onNavigateToInvestigation,
  initialTab = 'comparison',
}) => {
  const [activeTab, setActiveTab] = useState<'comparison' | 'testing' | 'checklist'>(initialTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-hidden">
      <div className="relative w-full max-w-7xl h-[92vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100 tracking-wide">
                  Research & Validation Workspace
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  AUDIT & VALIDATION SUITE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Advanced ablation testing, controlled anomaly generators, ML experiments (Phase 5F), and infrastructure checklists.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Navigation Tabs */}
            <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700">
              <button
                id="btn-tab-modal-comparison"
                onClick={() => setActiveTab('comparison')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === 'comparison'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Baseline Ablation & Comparison</span>
              </button>

              <button
                id="btn-tab-modal-testing"
                onClick={() => setActiveTab('testing')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === 'testing'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>NASA FIRMS & Controlled Tests</span>
              </button>

              <button
                id="btn-tab-modal-checklist"
                onClick={() => setActiveTab('checklist')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === 'checklist'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Infra Checklist</span>
              </button>
            </div>

            {/* Close Button */}
            <button
              id="btn-close-research-modal"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950/40">
          {activeTab === 'comparison' && <BaselineComparison />}

          {activeTab === 'testing' && (
            <LiveFirmsAndTesting
              facilities={facilities}
              onAddEvent={onAddEvent || (() => {})}
              onBulkAddEvents={onBulkAddEvents || (() => {})}
              onNavigateToInvestigation={(caseId) => {
                onClose();
                if (onNavigateToInvestigation) onNavigateToInvestigation(caseId);
              }}
            />
          )}

          {activeTab === 'checklist' && (
            <div className="max-w-4xl mx-auto py-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-cyan-400" />
                    <h3 className="font-bold text-slate-100">Production Infrastructure & Verification Checklist</h3>
                  </div>
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded">
                    SYSTEM OPERATIONAL
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  The ThermalSentinel analytical architecture relies on a multi-tiered pipeline of live external APIs and empirical facility baselines. All components below are operational.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      NASA FIRMS Live API Ingestion
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      Authentic satellite NRT passes over India corridor from VIIRS NOAA-20 and Suomi-NPP.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Empirical Historical Baselines
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      Empirically derived quantiles (P50, P75, P95) from 294 historical observations at Jamnagar.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Copernicus Data Space Sentinel-2
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      OAuth client credentials token management with B11/B12 SWIR retrieval and temporal verification.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      OpenStreetMap Overpass API
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      Live spatial queries of mapped flare stacks, storage tanks, and industrial nodes within 3.0 km.
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Open-Meteo ERA5 Reanalysis Weather
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      Hourly atmospheric parameters aligned with FIRMS detection timestamps (delta t ≤ 13 min).
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      Frozen ML Model Advisory
                    </div>
                    <p className="text-slate-400 text-[11px]">
                      Phase 5F standardized Logistic Regression discriminator (lr-v5f3-standardized) active in advisory role.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
