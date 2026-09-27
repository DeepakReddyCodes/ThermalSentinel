import React, { useState } from 'react';
import {
  X,
  Satellite,
  Layers,
  Flame,
  Wind,
  ShieldCheck,
  Eye,
  Info,
  Sliders,
  CheckCircle,
} from 'lucide-react';
import { EvidenceItem } from '../types';

interface EvidenceViewerModalProps {
  evidence: EvidenceItem | null;
  onClose: () => void;
  onApplyEvidence: (evidenceId: string) => void;
  isApplied: boolean;
}

export const EvidenceViewerModal: React.FC<EvidenceViewerModalProps> = ({
  evidence,
  onClose,
  onApplyEvidence,
  isApplied,
}) => {
  const [bandView, setBandView] = useState<'swir' | 'rgb' | 'plume'>('swir');

  if (!evidence) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <Satellite className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-amber-400 font-bold px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                  {evidence.sensor}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Utility Score: <strong className="text-emerald-400">{evidence.utilityScore}/100</strong>
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-100 mt-0.5">
                {evidence.title}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Controlled Scenario High-Visibility Advisory Banner */}
        {(evidence.dataProvenance === 'CONTROLLED EVIDENCE SCENARIO' || (evidence as any).provenance === 'CONTROLLED' || evidence.id?.startsWith('EVID-')) && (
          <div className="bg-amber-950/80 border-b border-amber-800/80 px-5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <div className="flex items-center gap-2 text-xs font-mono text-amber-200">
              <span className="px-1.5 py-0.5 rounded bg-amber-900 border border-amber-600 text-[9px] font-bold tracking-wider text-amber-100 uppercase">
                CONTROLLED SCENARIO
              </span>
              <span className="font-semibold text-amber-300">
                CONTROLLED SCENARIO EVIDENCE
              </span>
            </div>
            <span className="text-[10px] text-amber-300/80 font-mono">
              Controlled evaluation scenario — curated multi-spectral acquisition for information-utility assessment
            </span>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Scientific Rationale Card */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Info className="w-4 h-4 text-sky-400" />
              <span>Evidence Utility Rationale</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              {evidence.rationale}
            </p>
          </div>

          {/* Interactive Multi-Spectral Viewer */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                <span>Sensor Imagery & Spectral Signature Analysis</span>
              </span>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  onClick={() => setBandView('swir')}
                  className={`px-3 py-1 rounded-md transition ${
                    bandView === 'swir'
                      ? 'bg-rose-500 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  SWIR 2.2µm (B12 Thermal)
                </button>
                <button
                  onClick={() => setBandView('rgb')}
                  className={`px-3 py-1 rounded-md transition ${
                    bandView === 'rgb'
                      ? 'bg-amber-500 text-slate-950 font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  True Color RGB (10m)
                </button>
                <button
                  onClick={() => setBandView('plume')}
                  className={`px-3 py-1 rounded-md transition ${
                    bandView === 'plume'
                      ? 'bg-sky-500 text-white font-medium'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Smoke Vector & NBR
                </button>
              </div>
            </div>

            {/* Simulated Canvas / Spectral Matrix Visual */}
            <div className="relative w-full h-64 bg-slate-950 rounded-xl border border-slate-800 overflow-hidden flex items-center justify-center p-4">
              {/* Background grid representing industrial ground texture */}
              <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px] opacity-30" />

              {/* Controlled evidence visual badge */}
              {(evidence.dataProvenance === 'CONTROLLED EVIDENCE SCENARIO' || (evidence as any).provenance === 'CONTROLLED' || evidence.id?.startsWith('EVID-')) && (
                <div className="absolute top-3 left-3 z-10 px-2 py-0.5 rounded bg-amber-950/90 border border-amber-600/80 text-[9px] font-mono font-bold text-amber-300 tracking-wider flex items-center gap-1 shadow-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>CONTROLLED SCENARIO · EVIDENCE AUDIT</span>
                </div>
              )}

              {/* Tank farm and flare stack layout schematic */}
              <div className="absolute top-8 left-12 w-28 h-20 rounded-lg border border-sky-500/40 bg-sky-900/10 flex flex-col items-center justify-center text-[10px] text-sky-400 font-mono">
                <span>Flare Header Stack</span>
                <span className="text-[9px] text-slate-400">ZONE-01 (Inactive)</span>
              </div>

              {/* Tank Farm Bunding where Fire is located */}
              <div className="absolute bottom-8 right-16 w-48 h-36 rounded-xl border-2 border-dashed border-rose-500/60 bg-rose-950/20 flex flex-col items-center justify-center p-2 text-center">
                <span className="text-[10px] font-mono font-bold text-rose-300">
                  Crude Tank Farm 14B Bunding
                </span>
                <span className="text-[9px] text-slate-400">
                  820m south of flare stack
                </span>

                {/* Thermal Anomaly Signature Overlay */}
                {bandView === 'swir' && (
                  <div className="mt-2 w-32 h-16 rounded-lg bg-gradient-to-r from-rose-600 via-amber-500 to-rose-600 opacity-90 shadow-xl shadow-rose-500/50 flex items-center justify-center animate-pulse">
                    <span className="text-[10px] font-bold text-slate-950">
                      Diffuse SWIR: 4,200 m²
                    </span>
                  </div>
                )}

                {bandView === 'rgb' && (
                  <div className="mt-2 w-32 h-16 rounded-lg bg-slate-700/80 border border-slate-600 flex items-center justify-center text-[10px] text-slate-300">
                    <span>Dense Black Carbon Plume</span>
                  </div>
                )}

                {bandView === 'plume' && (
                  <div className="mt-2 w-36 h-16 rounded-lg bg-gradient-to-l from-sky-600/60 to-purple-600/60 border border-sky-400/50 flex items-center justify-center text-[10px] text-sky-200">
                    <span>NBR: -0.42 (Combustion Index)</span>
                  </div>
                )}
              </div>

              {/* Wind Vector Arrow */}
              {evidence.evidenceFindings.smokePlumeDetected && (
                <div className="absolute top-4 right-4 bg-slate-900/90 p-2 rounded-lg border border-slate-700 text-[10px] text-slate-300 flex items-center gap-2">
                  <Wind className="w-4 h-4 text-sky-400" />
                  <span>Wind Azimuth: <strong>245° (WSW)</strong></span>
                </div>
              )}
            </div>
          </div>

          {/* Finding Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400">Spatial Thermal Area:</span>
              <p className="text-slate-100 font-mono font-bold text-sm mt-0.5">
                {evidence.evidenceFindings.pixelFootprintSqMeters} m²
              </p>
              <span className="text-[10px] text-rose-400 font-medium">
                28x larger than flare stack
              </span>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400">SWIR Morphology:</span>
              <p className="text-amber-400 font-mono font-bold text-sm mt-0.5 capitalize">
                {evidence.evidenceFindings.swirThermalPattern.replace(/_/g, ' ')}
              </p>
              <span className="text-[10px] text-slate-400">
                Non-point source
              </span>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400">Smoke Plume Vector:</span>
              <p className="text-sky-400 font-mono font-bold text-sm mt-0.5">
                {evidence.evidenceFindings.smokePlumeDetected ? 'CONFIRMED' : 'NONE'}
              </p>
              <span className="text-[10px] text-slate-400">
                1.8km east-northeast
              </span>
            </div>

            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400">Combustion Index (NBR):</span>
              <p className="text-rose-400 font-mono font-bold text-sm mt-0.5">
                {evidence.evidenceFindings.spectralIndex_NBR}
              </p>
              <span className="text-[10px] text-slate-400">
                Severe vegetation/fuel scorch
              </span>
            </div>
          </div>

          {/* Detailed Summary Text */}
          <div className="bg-slate-800/40 p-4 rounded-xl border border-slate-700 text-xs text-slate-200 leading-relaxed">
            <strong className="text-slate-100 block mb-1">Evidence Engine Assessment:</strong>
            {evidence.evidenceFindings.summary}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800 bg-slate-950/80">
          <span className="text-xs text-slate-400">
            Applying this evidence updates hypothesis assessment via recursive Bayesian evidence fusion.
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
            >
              Close Viewer
            </button>
            <button
              onClick={() => {
                onApplyEvidence(evidence.id);
                onClose();
              }}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                isApplied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 shadow-md shadow-amber-500/20'
              }`}
            >
              <CheckCircle className="w-4 h-4" />
              <span>{isApplied ? 'Evidence Already Applied' : 'Fuse Evidence Into Case'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
