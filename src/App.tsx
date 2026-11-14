import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Upload,
  FileAudio,
  Sparkles,
  Search,
  Copy,
  Download,
  FileText,
  History,
  Settings,
  MessageSquare,
  Check,
  AlertCircle,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  ExternalLink,
  Shield,
  KeyRound,
  X,
  Volume2,
  Video,
  FileVideo,
  Film
} from "lucide-react";
import { jsPDF } from "jspdf";

interface ParsedResult {
  transcription: string;
  summary: string;
  vocabulary: Array<{ term: string; meaning: string }>;
}

interface HistoryItem {
  id?: number;
  timestamp: string;
  fileName: string;
  fileSize: string;
  duration?: string;
  rawText: string;
  parsed?: ParsedResult;
  instruction?: string;
  mode: string;
}

export default function App() {
  // Modes & Inputs
  const [mode, setMode] = useState<"hinglish" | "english">("hinglish");
  const [inputTab, setInputTab] = useState<"record" | "upload">("record");
  const [instruction, setInstruction] = useState("");
  
  // Media (Audio & Video) state
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string>("");
  const [audioSize, setAudioSize] = useState<string>("");
  const [mimeType, setMimeType] = useState<string>("audio/webm");
  const [isVideo, setIsVideo] = useState<boolean>(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Transcription state
  const [isProcessing, setIsProcessing] = useState(false);
  const [rawOutput, setRawOutput] = useState<string>("");
  const [parsedResult, setParsedResult] = useState<ParsedResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // Modals & Drawers
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Auth / Session
  const [userEmail, setUserEmail] = useState<string>("farain539@gmail.com");
  const [sessionToken, setSessionToken] = useState<string>("");
  const [hasApiKey, setHasApiKey] = useState<boolean>(true);
  const [newApiKey, setNewApiKey] = useState<string>("");
  const [saveKeySuccess, setSaveKeySuccess] = useState(false);

  // Assistant Chat
  const [assistantOption, setAssistantOption] = useState<"project" | "developer">("project");
  const [chatMessage, setChatMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    {
      role: "assistant",
      text: "Namaste & Hello! I'm your Hinglish Transcriber AI Assistant. How can I help you today?"
    }
  ]);

  // Initial session bypass & config check
  useEffect(() => {
    async function initSession() {
      try {
        const bypassRes = await fetch("/api/auth/bypass", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "farain539@gmail.com" }),
        });
        const bypassData = await bypassRes.json();
        if (bypassData.token) {
          setSessionToken(bypassData.token);
          loadHistory("farain539@gmail.com");
        }

        const configRes = await fetch("/api/config");
        const configData = await configRes.json();
        setHasApiKey(configData.hasApiKey);
      } catch (e) {
        console.error("Init session error:", e);
      }
    }
    initSession();
  }, []);

  // Fetch History
  const loadHistory = async (email: string) => {
    try {
      const res = await fetch(`/api/history?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      }
    } catch (e) {
      console.error("Error loading history:", e);
    }
  };

  // Live Canvas Waveform Drawing
  const drawWaveform = () => {
    if (!analyserRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const renderFrame = () => {
      animationFrameRef.current = requestAnimationFrame(renderFrame);
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 3;
      // Vibrant Hinglish gradient
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, "#f97316"); // orange
      gradient.addColorStop(0.5, "#ec4899"); // pink
      gradient.addColorStop(1, "#3b82f6"); // blue
      ctx.strokeStyle = gradient;

      ctx.beginPath();
      const sliceWidth = (canvas.width * 1.0) / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    renderFrame();
  };

  // Recording Controls
  const startRecording = async () => {
    try {
      setErrorMsg(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      // Setup audio analyzer
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setAudioName(`voice_recording_${new Date().toLocaleTimeString().replace(/:/g, "-")}.webm`);
        setAudioSize(`${(blob.size / 1024).toFixed(1)} KB`);
        setMimeType("audio/webm");
        setIsVideo(false);

        // Stop stream tracks
        stream.getTracks().forEach((track) => track.stop());
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setIsVideo(false);
      setRecordingDuration(0);

      timerRef.current = window.setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      drawWaveform();
    } catch (err: any) {
      console.error("Mic access error:", err);
      setErrorMsg("Microphone access denied or not available. Please allow mic permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  // File Upload (Audio & Video)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      setErrorMsg("File size exceeds 100MB limit.");
      return;
    }

    const detectedIsVideo = file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|flv|wmv|m4v)$/i.test(file.name);
    setIsVideo(detectedIsVideo);

    let detectedMime = file.type;
    if (!detectedMime) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'mp4') detectedMime = 'video/mp4';
      else if (ext === 'mov') detectedMime = 'video/quicktime';
      else if (ext === 'webm') detectedMime = detectedIsVideo ? 'video/webm' : 'audio/webm';
      else if (ext === 'mkv') detectedMime = 'video/x-matroska';
      else if (ext === 'avi') detectedMime = 'video/x-msvideo';
      else if (ext === 'mp3') detectedMime = 'audio/mpeg';
      else if (ext === 'wav') detectedMime = 'audio/wav';
      else if (ext === 'm4a') detectedMime = 'audio/mp4';
      else detectedMime = detectedIsVideo ? 'video/mp4' : 'audio/mp3';
    }

    setAudioBlob(file);
    setAudioUrl(URL.createObjectURL(file));
    setAudioName(file.name);
    setAudioSize(`${(file.size / (1024 * 1024)).toFixed(2)} MB`);
    setMimeType(detectedMime);
  };

  // Helper to parse LLM structured transcription response
  const parseTranscriptionResponse = (raw: string): ParsedResult => {
    let transcription = raw;
    let summary = "";
    const vocabulary: Array<{ term: string; meaning: string }> = [];

    // Split for summary
    const summaryIndex = raw.indexOf("**English Summary:**");
    const summaryAltIndex = raw.indexOf("English Summary:");
    const vocabIndex = raw.indexOf("**Key Words / Vocabulary**");
    const vocabAltIndex = raw.indexOf("Key Words / Vocabulary");

    const sStart = summaryIndex !== -1 ? summaryIndex : summaryAltIndex;
    const vStart = vocabIndex !== -1 ? vocabIndex : vocabAltIndex;

    if (sStart !== -1) {
      transcription = raw.substring(0, sStart).replace(/---\s*$/, "").trim();

      if (vStart !== -1 && vStart > sStart) {
        summary = raw.substring(sStart, vStart).replace(/\*\*English Summary:\*\*|English Summary:/i, "").replace(/---/g, "").trim();
        const vocabSection = raw.substring(vStart).replace(/\*\*Key Words \/ Vocabulary\*\*|Key Words \/ Vocabulary/i, "").trim();
        
        // Parse vocab bullets
        const lines = vocabSection.split("\n");
        for (const line of lines) {
          const cleaned = line.replace(/^[\*\-\•\d\.\s]+/, "").trim();
          if (cleaned.includes(":") || cleaned.includes("-")) {
            const separator = cleaned.includes(":") ? ":" : "-";
            const parts = cleaned.split(separator);
            if (parts.length >= 2) {
              vocabulary.push({
                term: parts[0].replace(/\*\*/g, "").trim(),
                meaning: parts.slice(1).join(separator).replace(/\*\*/g, "").trim()
              });
            }
          }
        }
      } else {
        summary = raw.substring(sStart).replace(/\*\*English Summary:\*\*|English Summary:/i, "").replace(/---/g, "").trim();
      }
    }

    return { transcription, summary, vocabulary };
  };

  // Transcribe Action (Audio & Video Voiceover)
  const handleTranscribe = async () => {
    if (!audioBlob) {
      setErrorMsg("Please record voice or upload an audio/video file first.");
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      // Convert Blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = async () => {
        const base64Media = reader.result as string;

        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audio: base64Media,
            media: base64Media,
            mimeType: mimeType || (isVideo ? "video/mp4" : "audio/webm"),
            instruction: instruction.trim() || undefined,
            mode: mode,
            isVideo: isVideo,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to transcribe voiceover.");
        }

        const raw = data.transcription;
        setRawOutput(raw);
        const parsed = parseTranscriptionResponse(raw);
        setParsedResult(parsed);

        // Save to History
        const historyItem: HistoryItem = {
          timestamp: new Date().toLocaleString(),
          fileName: audioName || (isVideo ? "Video_Voiceover" : "Audio_Recording"),
          fileSize: audioSize || "1.0 MB",
          duration: recordingDuration ? `${recordingDuration}s` : undefined,
          rawText: raw,
          parsed,
          instruction: instruction || undefined,
          mode,
        };

        try {
          await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: userEmail,
              item: historyItem,
            }),
          });
          loadHistory(userEmail);
        } catch (e) {
          console.warn("Could not persist history:", e);
        }

        setIsProcessing(false);
      };
    } catch (err: any) {
      console.error("Transcribe failed:", err);
      setErrorMsg(err.message || "An error occurred while processing the transcription.");
      setIsProcessing(false);
    }
  };

  // Assistant Query
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || chatLoading) return;

    const userText = chatMessage.trim();
    setChatMessage("");
    setChatHistory((prev) => [...prev, { role: "user", text: userText }]);
    setChatLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          option: assistantOption,
          message: userText,
          history: chatHistory,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error in assistant response");

      setChatHistory((prev) => [...prev, { role: "assistant", text: data.reply }]);
    } catch (err: any) {
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: `⚠️ Error: ${err.message || "Could not reach assistant"}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // Export PDF
  const handleExportPDF = () => {
    if (!parsedResult) return;
    const doc = new jsPDF();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(30, 41, 59);
    doc.text("Hinglish Audio Transcription Report", 14, 20);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated on: ${new Date().toLocaleString()} | Mode: ${mode.toUpperCase()}`, 14, 28);
    doc.line(14, 32, 196, 32);

    let yOffset = 42;

    // Transcription text
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Transcription:", 14, yOffset);
    yOffset += 8;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(51, 65, 85);
    const splitTranscription = doc.splitTextToSize(parsedResult.transcription || rawOutput, 180);
    doc.text(splitTranscription, 14, yOffset);
    yOffset += splitTranscription.length * 6 + 10;

    // Summary
    if (parsedResult.summary && yOffset < 250) {
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("English Summary:", 14, yOffset);
      yOffset += 8;

      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(51, 65, 85);
      const splitSummary = doc.splitTextToSize(parsedResult.summary, 180);
      doc.text(splitSummary, 14, yOffset);
      yOffset += splitSummary.length * 6 + 10;
    }

    // Vocabulary
    if (parsedResult.vocabulary.length > 0 && yOffset < 240) {
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("Key Vocabulary & Glossary:", 14, yOffset);
      yOffset += 8;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      parsedResult.vocabulary.forEach((v) => {
        if (yOffset > 280) {
          doc.addPage();
          yOffset = 20;
        }
        doc.setFont("helvetica", "bold");
        doc.text(`• ${v.term}: `, 14, yOffset);
        doc.setFont("helvetica", "normal");
        doc.text(v.meaning, 55, yOffset);
        yOffset += 6;
      });
    }

    doc.save(`${audioName || "hinglish_transcription"}.pdf`);
  };

  // Export TXT
  const handleExportTXT = () => {
    const textToExport = rawOutput || parsedResult?.transcription || "";
    const element = document.createElement("a");
    const file = new Blob([textToExport], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `${audioName || "transcription"}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Copy to clipboard
  const handleCopy = () => {
    const text = parsedResult?.transcription || rawOutput;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Save custom Gemini API Key
  const handleSaveApiKey = async () => {
    if (!newApiKey.trim() || !sessionToken) return;
    try {
      const res = await fetch("/api/admin/settings/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: sessionToken,
          settings: {
            gemini_api_key: newApiKey.trim(),
          },
        }),
      });
      if (res.ok) {
        setSaveKeySuccess(true);
        setHasApiKey(true);
        setTimeout(() => setSaveKeySuccess(false), 3000);
      }
    } catch (e) {
      console.error("Save api key error:", e);
    }
  };

  // Format recording timer
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-orange-500/30 selection:text-orange-200">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-orange-500 via-rose-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-orange-500/20 ring-1 ring-white/20">
            <Mic className="h-5 w-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg text-white tracking-tight">Hinglish Transcriber</h1>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-gradient-to-r from-orange-500/20 to-pink-500/20 text-orange-400 border border-orange-500/30">
                AI Studio
              </span>
            </div>
            <p className="text-xs text-slate-400">Casual Bilingual Speech to Roman Hinglish & English</p>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* API Key Status Pill */}
          <button
            onClick={() => setShowSettings(true)}
            className={`hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition ${
              hasApiKey
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20 animate-pulse"
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>{hasApiKey ? "Gemini Ready" : "Set Gemini Key"}</span>
          </button>

          {/* Ask AI Assistant */}
          <button
            onClick={() => setShowAssistant(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 transition shadow-sm"
          >
            <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Ask AI Assistant</span>
          </button>

          {/* History */}
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition"
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">History ({historyList.length})</span>
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition"
            title="Settings & System Diagnostics"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Notice if no API key configured */}
        {!hasApiKey && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-start gap-3 text-sm">
            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold">Gemini API Key Required:</span> To process audio transcriptions, please configure your Gemini API Key in the Settings panel or add it to your <code className="bg-slate-900 px-1.5 py-0.5 rounded text-amber-200">.env</code> file.
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="px-3 py-1 text-xs font-semibold rounded bg-amber-500 text-slate-950 hover:bg-amber-400 transition"
            >
              Configure Key
            </button>
          </div>
        )}

        {/* Top Control Bar: Mode selection */}
        <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-orange-400" />
              <span>Target Transcription Mode</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Choose phonetic Roman Hinglish or direct standard English translation
            </p>
          </div>

          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 self-start sm:self-auto w-full md:w-auto">
            <button
              onClick={() => setMode("hinglish")}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-2 ${
                mode === "hinglish"
                  ? "bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow-md shadow-orange-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <span>🗣️ Roman Hinglish</span>
              <span className="text-[10px] opacity-80">(e.g. "Kya haal hai")</span>
            </button>
            <button
              onClick={() => setMode("english")}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-medium transition flex items-center justify-center gap-2 ${
                mode === "english"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <span>🌐 English Translation</span>
              <span className="text-[10px] opacity-80">(Grammatical)</span>
            </button>
          </div>
        </div>

        {/* Audio Input Box */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Input Selection & Recording / Upload */}
          <div className="lg:col-span-6 bg-slate-900/60 backdrop-blur-sm border border-slate-800/80 rounded-2xl p-5 shadow-xl flex flex-col space-y-4">
            {/* Input Tabs */}
            <div className="flex border-b border-slate-800 pb-3 gap-3">
              <button
                onClick={() => setInputTab("record")}
                className={`flex items-center gap-2 text-sm font-semibold pb-1.5 transition border-b-2 ${
                  inputTab === "record"
                    ? "border-orange-500 text-orange-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Mic className="h-4 w-4" />
                <span>Live Voice Record</span>
              </button>
              <button
                onClick={() => setInputTab("upload")}
                className={`flex items-center gap-2 text-sm font-semibold pb-1.5 transition border-b-2 ${
                  inputTab === "upload"
                    ? "border-orange-500 text-orange-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Upload className="h-4 w-4" />
                <span>Upload Audio / Video</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1 font-normal">
                  <Film className="h-2.5 w-2.5" />
                  <span>Voiceover</span>
                </span>
              </button>
            </div>

            {/* TAB 1: Live Voice Recording */}
            {inputTab === "record" ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950/70 border border-slate-800/60 rounded-xl space-y-4">
                {/* Waveform Canvas */}
                <div className="w-full h-24 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 relative flex items-center justify-center">
                  <canvas
                    ref={canvasRef}
                    width={450}
                    height={96}
                    className="w-full h-full"
                  />
                  {!isRecording && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 bg-slate-950/80">
                      Waveform visualizer will activate upon recording
                    </div>
                  )}
                </div>

                {/* Record Button & Pulse */}
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`h-20 w-20 rounded-full flex items-center justify-center transition shadow-2xl relative ${
                      isRecording
                        ? "bg-rose-600 hover:bg-rose-700 text-white ring-8 ring-rose-500/20 animate-pulse"
                        : "bg-gradient-to-tr from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white shadow-orange-500/30 hover:scale-105"
                    }`}
                  >
                    {isRecording ? (
                      <MicOff className="h-8 w-8" />
                    ) : (
                      <Mic className="h-8 w-8" />
                    )}
                  </button>
                  <div className="text-center">
                    <span className="text-sm font-medium text-slate-300">
                      {isRecording ? "Listening to Hinglish speech..." : "Click to Start Speaking"}
                    </span>
                    {isRecording && (
                      <div className="text-rose-400 font-mono text-xs font-bold mt-0.5">
                        REC {formatTime(recordingDuration)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Ready Audio Badge */}
                {audioBlob && !isRecording && (
                  <div className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <Volume2 className="h-4 w-4 text-orange-400 shrink-0" />
                      <div className="text-xs truncate">
                        <span className="font-medium text-slate-200">{audioName}</span>
                        <span className="text-slate-500 ml-2">({audioSize})</span>
                      </div>
                    </div>
                    {audioUrl && (
                      <audio controls src={audioUrl} className="h-7 w-44 shrink-0" />
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* TAB 2: File Upload (Audio & Video Voiceover) */
              <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950/70 border border-slate-800/60 rounded-xl space-y-4">
                <label className="w-full border-2 border-dashed border-slate-700 hover:border-orange-500/60 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition bg-slate-900/30 hover:bg-slate-900/60 group">
                  <div className="h-12 w-12 rounded-full bg-slate-800 group-hover:bg-orange-500/20 group-hover:text-orange-400 text-slate-400 flex items-center justify-center transition mb-3">
                    {isVideo ? <Video className="h-6 w-6 text-rose-400" /> : <Upload className="h-6 w-6" />}
                  </div>
                  <span className="text-sm font-medium text-slate-200 text-center">
                    Click to select audio or video file, or drag &amp; drop
                  </span>
                  <span className="text-xs text-slate-400 mt-1 text-center">
                    Supports <strong>Audio</strong> (MP3, WAV, M4A, WebM) &amp; <strong>Video</strong> (MP4, MOV, MKV, WebM) up to 100MB
                  </span>
                  <div className="mt-3 text-[11px] text-amber-300 bg-amber-500/10 px-3 py-1.5 rounded-full border border-amber-500/20 flex items-center gap-1.5 text-center">
                    <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span>Video Voiceover: Video mein boli gayi awaaz (voiceover/dialogue) detect kar ke likh dega!</span>
                  </div>
                  <input
                    type="file"
                    accept="audio/*,video/*,.mp3,.wav,.m4a,.webm,.mp4,.mov,.mkv,.avi,.ogg"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                {audioBlob && (
                  <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3">
                    <div className="flex items-center justify-between overflow-hidden">
                      <div className="flex items-center gap-2 overflow-hidden">
                        {isVideo ? (
                          <Video className="h-4 w-4 text-rose-400 shrink-0" />
                        ) : (
                          <FileAudio className="h-4 w-4 text-orange-400 shrink-0" />
                        )}
                        <div className="text-xs truncate">
                          <span className="font-medium text-slate-200">{audioName}</span>
                          <span className="text-slate-500 ml-2">({audioSize})</span>
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        isVideo
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                      }`}>
                        {isVideo ? "🎬 Video Voiceover Detected" : "🎵 Audio File"}
                      </span>
                    </div>

                    {audioUrl && (
                      isVideo ? (
                        <div className="rounded-lg overflow-hidden border border-slate-800 bg-black flex justify-center">
                          <video
                            controls
                            src={audioUrl}
                            className="w-full max-h-56 object-contain"
                          />
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <audio controls src={audioUrl} className="h-7 w-full shrink-0" />
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Instruction Context Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 flex items-center justify-between">
                <span>Custom Instructions / Context (Optional)</span>
                <span className="text-[11px] text-slate-500">e.g. Speaker names, technical terms</span>
              </label>
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={isVideo ? "e.g. Focus on the main narrator's voice, ignore background music..." : "e.g. Speaker is talking about web development and Pakistani tech startups..."}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition"
              />
            </div>

            {/* Transcribe Action Button */}
            <button
              onClick={handleTranscribe}
              disabled={!audioBlob || isProcessing || isRecording}
              className={`w-full py-3.5 rounded-xl font-semibold text-sm transition shadow-lg flex items-center justify-center gap-2 ${
                !audioBlob || isProcessing || isRecording
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50"
                  : isVideo
                  ? "bg-gradient-to-r from-rose-500 via-orange-500 to-indigo-600 hover:from-rose-600 hover:via-orange-600 hover:to-indigo-700 text-white shadow-rose-500/25 hover:shadow-rose-500/40"
                  : "bg-gradient-to-r from-orange-500 via-rose-500 to-indigo-600 hover:from-orange-600 hover:via-rose-600 hover:to-indigo-700 text-white shadow-orange-500/25 hover:shadow-orange-500/40"
              }`}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  <span>
                    {isVideo
                      ? "Extracting & Transcribing Video Voiceover with Gemini..."
                      : "Transcribing with Gemini 3.5..."}
                  </span>
                </>
              ) : (
                <>
                  {isVideo ? <Video className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                  <span>{isVideo ? "Transcribe Video Voiceover" : "Transcribe Speech Now"}</span>
                </>
              )}
            </button>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Right: Results & Analysis View */}
          <div className="lg:col-span-6 bg-slate-900/60 backdrop-blur-sm border border-slate-800/80 rounded-2xl p-5 shadow-xl flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <FileText className="h-4 w-4 text-orange-400" />
                <span>Transcription & Intelligence</span>
              </h2>

              {/* Export Toolbar */}
              {parsedResult && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCopy}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    title="Copy Text"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={handleExportTXT}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition"
                    title="Download .TXT"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleExportPDF}
                    className="px-2.5 py-1 rounded-lg bg-orange-600/20 text-orange-300 border border-orange-500/30 hover:bg-orange-600/30 text-xs font-medium transition"
                    title="Export PDF Report"
                  >
                    PDF
                  </button>
                </div>
              )}
            </div>

            {/* Results Content */}
            {!parsedResult ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-3">
                <div className="h-16 w-16 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-600">
                  <Mic className="h-8 w-8" />
                </div>
                <div className="max-w-xs">
                  <p className="text-sm font-medium text-slate-400">No transcription yet</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Record voice or upload an audio or video file on the left to extract voiceovers, view romanized Hinglish, English translations, and summaries.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col space-y-4 overflow-y-auto max-h-[580px] pr-1">
                {/* Search Bar for output */}
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search words in transcription..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-orange-500/60 transition"
                  />
                </div>

                {/* Card 1: Main Output */}
                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800/80 pb-2">
                    <span className="font-semibold text-orange-400 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      {isVideo && <Video className="h-3.5 w-3.5 text-rose-400" />}
                      <span>
                        {isVideo
                          ? mode === "hinglish"
                            ? "Video Voiceover (Roman Hinglish)"
                            : "Video Voiceover (English Translation)"
                          : mode === "hinglish"
                          ? "Roman Hinglish Output"
                          : "Standard English Output"}
                      </span>
                    </span>
                    <span className="truncate max-w-[200px]">{audioName}</span>
                  </div>
                  <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
                    {parsedResult.transcription || rawOutput}
                  </div>
                </div>

                {/* Card 2: AI Summary */}
                {parsedResult.summary && (
                  <div className="bg-indigo-950/30 border border-indigo-900/50 rounded-xl p-4 space-y-2">
                    <span className="font-semibold text-indigo-400 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Executive English Summary</span>
                    </span>
                    <p className="text-xs text-indigo-200/90 leading-relaxed">
                      {parsedResult.summary}
                    </p>
                  </div>
                )}

                {/* Card 3: Key Vocabulary & Glossary */}
                {parsedResult.vocabulary.length > 0 && (
                  <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                    <span className="font-semibold text-emerald-400 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <span>Key Vocabulary & Hinglish Glossary</span>
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {parsedResult.vocabulary.map((vocab, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col justify-between"
                        >
                          <span className="text-xs font-bold text-orange-300">
                            {vocab.term}
                          </span>
                          <span className="text-[11px] text-slate-400 mt-0.5">
                            {vocab.meaning}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* History Drawer */}
      {showHistory && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-slate-900 h-full p-6 border-l border-slate-800 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-orange-400" />
                <h3 className="font-bold text-base text-white">Transcription History</h3>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {historyList.length === 0 ? (
                <div className="text-center text-xs text-slate-500 py-12">
                  No previous transcriptions found in database.
                </div>
              ) : (
                historyList.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition cursor-pointer"
                    onClick={() => {
                      setRawOutput(item.rawText);
                      setParsedResult(item.parsed || parseTranscriptionResponse(item.rawText));
                      setAudioName(item.fileName);
                      setShowHistory(false);
                    }}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="font-medium text-slate-200 truncate">{item.fileName}</span>
                      <span className="text-[10px] text-slate-500">{item.timestamp}</span>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">
                      {item.rawText}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Modal */}
      {showAssistant && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl flex flex-col h-[600px] overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Hinglish AI Assistant</h3>
                  <div className="flex gap-2 text-[10px] text-slate-400">
                    <button
                      onClick={() => setAssistantOption("project")}
                      className={`hover:text-white ${assistantOption === "project" ? "text-indigo-400 font-bold underline" : ""}`}
                    >
                      About Project
                    </button>
                    <span>•</span>
                    <button
                      onClick={() => setAssistantOption("developer")}
                      className={`hover:text-white ${assistantOption === "developer" ? "text-indigo-400 font-bold underline" : ""}`}
                    >
                      About Developer (Bilal Faisal)
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowAssistant(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Chat Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/40">
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-orange-600 text-white rounded-br-none"
                        : "bg-slate-800 border border-slate-700/60 text-slate-200 rounded-bl-none"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 border border-slate-700/60 rounded-2xl rounded-bl-none px-4 py-2 text-xs text-slate-400 flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendChatMessage} className="p-3 border-t border-slate-800 bg-slate-950 flex gap-2">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Ask about Hinglish features, pipeline or developer..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatMessage.trim()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-50 transition"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-orange-400" />
                <h3 className="font-bold text-base text-white">System Settings</h3>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Gemini API Key Config */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-orange-400" />
                <span>Google Gemini API Key</span>
              </label>
              <input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="Enter AI Studio Gemini API Key"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-orange-500 transition font-mono"
              />
              <p className="text-[11px] text-slate-500">
                Key will be stored in your local embedded PostgreSQL database settings table.
              </p>
              <button
                onClick={handleSaveApiKey}
                className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold transition"
              >
                Save Gemini API Key
              </button>
              {saveKeySuccess && (
                <div className="text-emerald-400 text-xs flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  <span>Key saved successfully!</span>
                </div>
              )}
            </div>

            {/* Diagnostics */}
            <div className="pt-3 border-t border-slate-800 space-y-2 text-xs">
              <span className="font-semibold text-slate-400">Database & Server Status</span>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5 text-slate-400">
                <div className="flex justify-between">
                  <span>Engine:</span>
                  <span className="text-emerald-400 font-mono">PostgreSQL (PGlite Active)</span>
                </div>
                <div className="flex justify-between">
                  <span>Port:</span>
                  <span className="text-slate-200 font-mono">3000</span>
                </div>
                <div className="flex justify-between">
                  <span>Developer:</span>
                  <span className="text-slate-200 font-medium">Muhammad Bilal Faisal</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-4 text-center text-xs text-slate-500 bg-slate-950">
        <p>
          Hinglish Audio Transcriber • Developed by{" "}
          <a
            href="https://github.com/BilalFaisaldev"
            target="_blank"
            rel="noreferrer"
            className="text-orange-400 hover:underline font-medium"
          >
            Muhammad Bilal Faisal
          </a>{" "}
          • Karachi, Pakistan 🇵🇰
        </p>
      </footer>
    </div>
  );
}
