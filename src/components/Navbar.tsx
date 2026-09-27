import React from 'react';
import {
  Flame,
  Activity,
  Layers,
  Search,
  ShieldAlert,
  FlaskConical,
  Radio,
  BarChart3,
  Building2,
  AlertOctagon,
} from 'lucide-react';
import { InvestigationCase, ThermalEvent } from '../types';

interface NavbarProps {
  currentTab: 'monitor' | 'facilities' | 'investigation';
  onSelectTab: (tab: 'monitor' | 'facilities' | 'investigation') => void;
  activeCases: InvestigationCase[];
  events: ThermalEvent[];
  onOpenResearchValidation: () => void;
  liveFeedInfo?: { source: string; count: number; timestamp: string; isLive: boolean } | null;
  baselineObservationCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  activeCases,
  events,
  onOpenResearchValidation,
  liveFeedInfo,
  baselineObservationCount = 294,
}) => {
  const highPriorityCount = activeCases.filter(
    (c) => (c.investigation_priority?.level || c.priorityLevel) === 'HIGH'
  ).length;

  const anomalousCount = events.filter((e) => {
    const b = e.behaviouralStatus || e.deviationStatus;
    return b === 'ANOMALOUS' || b === 'HIGH_DEVIATION';
  }).length;

  return (
    <header className="bg-slate-950/95 border-b border-slate-800/80 sticky top-0 z-50 backdrop-blur-md">
      <div className="w-full px-3 sm:px-5 lg:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Brand Logo & Tagline */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 via-rose-500 to-cyan-500 shadow-md shadow-amber-500/20">
              <Flame className="w-5 h-5 text-slate-950 stroke-[2.5]" />
              <div
                className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-slate-950"
                title="Telemetry Pipeline Active"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-['Chakra_Petch'] font-bold text-base tracking-wider text-slate-100">
                  THERMAL<span className="text-amber-400">SENTINEL</span>
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-900 border border-slate-700/80 text-cyan-400">
                  SIH26162
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium hidden lg:block tracking-tight">
                Evidence-Guided Industrial Thermal Intelligence
              </p>
            </div>
          </div>

          {/* Center: Operational Telemetry Status Strip */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 pr-2.5 border-r border-slate-800">
              {liveFeedInfo?.isLive ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="text-emerald-400 font-semibold tracking-wider">FIRMS LIVE</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-emerald-400 font-semibold tracking-wider">FIRMS LIVE</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 px-2 border-r border-slate-800 text-slate-300">
              <span className="text-amber-400 font-bold">{events.length.toLocaleString()}</span>
              <span className="text-slate-500 text-[10px]">DETECTIONS</span>
            </div>

            <div className="flex items-center gap-1 px-2 border-r border-slate-800 text-slate-300">
              <span className="text-sky-400 font-bold">{activeCases.length}</span>
              <span className="text-slate-500 text-[10px]">INVESTIGATIONS</span>
            </div>

            <div className="flex items-center gap-1 px-2 border-r border-slate-800 text-slate-300">
              <span className="text-rose-400 font-bold">{anomalousCount}</span>
              <span className="text-slate-500 text-[10px]">ANOMALOUS</span>
            </div>

            <div className="flex items-center gap-1 pl-2 text-slate-300">
              <span className="text-emerald-400 font-bold">{baselineObservationCount}</span>
              <span className="text-slate-500 text-[10px]">BASELINE OBS</span>
            </div>
          </div>

          {/* Right Navigation Controls */}
          <div className="flex items-center gap-2">
            {/* Primary Product Tabs: MONITOR, INVESTIGATIONS, FACILITIES */}
            <nav className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800/90 shadow-inner">
              <button
                id="nav-tab-monitor"
                onClick={() => onSelectTab('monitor')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                  currentTab === 'monitor'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>MONITOR</span>
              </button>

              <button
                id="nav-tab-investigation"
                onClick={() => onSelectTab('investigation')}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                  currentTab === 'investigation'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm shadow-rose-500/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>INVESTIGATIONS</span>
                {highPriorityCount > 0 && (
                  <span className="flex items-center justify-center w-4 h-4 text-[9px] font-bold bg-rose-500 text-white rounded-full">
                    {highPriorityCount}
                  </span>
                )}
              </button>

              <button
                id="nav-tab-facilities"
                onClick={() => onSelectTab('facilities')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                  currentTab === 'facilities'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>FACILITIES</span>
              </button>
            </nav>

            {/* Secondary Research & Validation Trigger */}
            <button
              id="btn-open-research-validation"
              onClick={onOpenResearchValidation}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 text-xs transition-colors"
              title="Open Research, Ablation, and Validation Workspace"
            >
              <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden xl:inline text-[11px] font-medium">Research & Validation</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
