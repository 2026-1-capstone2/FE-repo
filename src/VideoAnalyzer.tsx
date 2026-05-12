import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  Film,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Play,
  Send,
  Bot,
  User,
  RotateCcw,
} from "lucide-react";

// Spring 백엔드 엔드포인트 (배포 시 실제 URL로 교체)
const API_BASE_URL = "http://localhost:8080";

// 데모 모드: true면 실제 fetch 대신 모의 응답을 사용
// 백엔드 연결 후에는 false로 바꾸세요
const DEMO_MODE = true;

// 타입 정의
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
};

type AnalysisResult = {
  videoId: string;
  duration: string;
  analysis: {
    objects: string[];
    scenes: number;
    confidence: number;
    summary: string;
  };
  processedAt: string;
};

type Status = "idle" | "uploading" | "analyzing" | "done" | "error";

export default function VideoAnalyzer() {
  // 영상 업로드 관련 상태
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 챗봇 관련 상태
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  const MAX_SIZE = 500 * 1024 * 1024; // 500MB

  // 분석 완료 시 챗봇 초기 메시지 추가
  useEffect(() => {
    if (status === "done" && result && messages.length === 0) {
      setMessages([
        {
          role: "assistant",
          content: `영상 분석이 완료되었습니다! 🎬\n\n${
            result.analysis?.summary || "영상에서 다양한 요소가 감지되었습니다."
          }\n\n영상에 대해 궁금한 점을 물어보세요. 예를 들어:\n• 영상에 어떤 객체들이 나타나나요?\n• 전체적인 분위기는 어떤가요?\n• 주요 장면을 요약해주세요`,
        },
      ]);
    }
  }, [status, result]);

  // 새 메시지 들어올 때마다 스크롤 맨 아래로
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isChatLoading]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const validateFile = (file: File): string | null => {
    if (!file.type.startsWith("video/")) {
      return "영상 파일만 업로드할 수 있습니다.";
    }
    if (file.size > MAX_SIZE) {
      return `파일 크기는 ${formatBytes(MAX_SIZE)} 이하여야 합니다.`;
    }
    return null;
  };

  const handleFile = (selectedFile: File | undefined | null) => {
    if (!selectedFile) return;
    const error = validateFile(selectedFile);
    if (error) {
      setErrorMsg(error);
      setStatus("error");
      return;
    }
    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
    setStatus("idle");
    setErrorMsg("");
    setResult(null);
    setUploadProgress(0);
    setMessages([]);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setStatus("idle");
    setUploadProgress(0);
    setResult(null);
    setErrorMsg("");
    setMessages([]);
    setChatInput("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // === 실제 백엔드 호출 ===
  const uploadToBackend = async (): Promise<AnalysisResult> => {
    if (!file) throw new Error("파일이 없습니다.");
    const formData = new FormData();
    formData.append("video", file);

    const uploadResult = await new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve({ raw: xhr.responseText });
          }
        } else {
          reject(new Error(`업로드 실패: ${xhr.status}`));
        }
      });
      xhr.addEventListener("error", () => reject(new Error("네트워크 오류")));
      xhr.open("POST", `${API_BASE_URL}/api/videos/upload`);
      xhr.send(formData);
    });

    setStatus("analyzing");

    const analyzeRes = await fetch(`${API_BASE_URL}/api/videos/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: uploadResult.videoId || uploadResult.id }),
    });

    if (!analyzeRes.ok) throw new Error(`분석 실패: ${analyzeRes.status}`);
    return await analyzeRes.json();
  };

  // 챗봇 메시지 전송 (실제 백엔드)
  const sendChatToBackend = async (userMessage: string): Promise<string> => {
    const res = await fetch(`${API_BASE_URL}/api/videos/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId: result?.videoId,
        message: userMessage,
        history: messages,
      }),
    });
    if (!res.ok) throw new Error(`챗봇 응답 실패: ${res.status}`);
    const data = await res.json();
    return data.reply || data.message || data.content;
  };

  // === 데모 모드 시뮬레이션 ===
  const mockUploadAndAnalyze = async (): Promise<AnalysisResult> => {
    for (let i = 0; i <= 100; i += 5) {
      await new Promise((r) => setTimeout(r, 80));
      setUploadProgress(i);
    }
    setStatus("analyzing");
    await new Promise((r) => setTimeout(r, 2500));
    return {
      videoId: "vid_" + Math.random().toString(36).slice(2, 10),
      duration: "00:01:24",
      analysis: {
        objects: ["person", "car", "building", "road", "tree"],
        scenes: 4,
        confidence: 0.92,
        summary: "영상에서 도심 거리를 걸어가는 사람들과 차량이 감지되었습니다.",
      },
      processedAt: new Date().toISOString(),
    };
  };

  const mockChatReply = async (userMessage: string): Promise<string> => {
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
    const lower = userMessage.toLowerCase();
    if (!result) return "분석 결과가 없습니다.";
    if (lower.includes("객체") || lower.includes("뭐") || lower.includes("무엇")) {
      return `영상에서 감지된 주요 객체는 다음과 같습니다:\n\n${result.analysis.objects
        .map((o: string, i: number) => `${i + 1}. ${o}`)
        .join("\n")}\n\n신뢰도는 ${(result.analysis.confidence * 100).toFixed(0)}%입니다.`;
    }
    if (lower.includes("장면") || lower.includes("요약") || lower.includes("내용")) {
      return `이 영상은 총 ${result.analysis.scenes}개의 장면으로 구성되어 있습니다.\n\n${result.analysis.summary}\n\n영상 길이: ${result.duration}`;
    }
    if (lower.includes("분위기") || lower.includes("느낌")) {
      return "영상은 일상적인 도심 풍경을 담고 있으며, 차분하고 자연스러운 분위기입니다. 특별한 이벤트나 극적인 장면은 감지되지 않았습니다.";
    }
    if (lower.includes("안녕") || lower.includes("하이")) {
      return "안녕하세요! 분석된 영상에 대해 무엇이든 물어보세요. 😊";
    }
    return `"${userMessage}"에 대한 답변을 드리자면, 분석 결과를 바탕으로 보았을 때 영상의 주요 내용은 ${result.analysis.summary}\n\n더 구체적으로 어떤 부분이 궁금하신가요?`;
  };

  const uploadAndAnalyze = async () => {
    if (!file) return;
    setStatus("uploading");
    setUploadProgress(0);
    setErrorMsg("");

    try {
      const data = DEMO_MODE ? await mockUploadAndAnalyze() : await uploadToBackend();
      setResult(data);
      setStatus("done");
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
      setErrorMsg(message);
      setStatus("error");
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed || isChatLoading) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const reply = DEMO_MODE
        ? await mockChatReply(trimmed)
        : await sendChatToBackend(trimmed);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "죄송합니다. 응답을 가져오는 중 오류가 발생했습니다.",
          isError: true,
        },
      ]);
    } finally {
      setIsChatLoading(false);
      chatInputRef.current?.focus();
    }
  };

  const suggestedQuestions = [
    "영상에 어떤 객체들이 나타나나요?",
    "영상 내용을 요약해주세요",
    "전체적인 분위기는 어떤가요?",
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* 헤더 */}
      <header className="border-b border-zinc-800 px-8 py-5 sticky top-0 bg-zinc-950/80 backdrop-blur-md z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-zinc-950" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Video AI Analyzer</h1>
              <p className="text-xs text-zinc-500">영상을 분석하고 AI와 대화하세요</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>AI Server Online</span>
            </div>
            {(file || status !== "idle") && (
              <button
                onClick={reset}
                className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-zinc-900"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                새로 시작
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-12">
        {/* 업로드 영역 - 파일 선택 전 */}
        {!file && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-16 transition-all duration-200 cursor-pointer ${
              isDragging
                ? "border-emerald-400 bg-emerald-400/5 scale-[1.01]"
                : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mb-5">
                <Upload className="w-7 h-7 text-zinc-400" strokeWidth={1.5} />
              </div>
              <h2 className="text-xl font-semibold mb-2">영상을 업로드하세요</h2>
              <p className="text-sm text-zinc-500 mb-1">
                파일을 드래그하거나 클릭하여 선택
              </p>
              <p className="text-xs text-zinc-600">
                MP4, MOV, AVI · 최대 500MB
              </p>
            </div>
          </div>
        )}

        {/* 파일 선택 후 ~ 분석 중 */}
        {file && status !== "done" && (
          <div className="max-w-3xl mx-auto">
            {/* 파일 정보 카드 */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden mb-4">
              {preview && status !== "error" && (
                <div className="aspect-video bg-black relative">
                  <video
                    src={preview}
                    controls
                    className="w-full h-full object-contain"
                  />
                </div>
              )}
              <div className="p-5 flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                  <Film className="w-5 h-5 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{file.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{formatBytes(file.size)}</p>
                </div>
                {status === "idle" && (
                  <button
                    onClick={reset}
                    className="w-9 h-9 rounded-lg hover:bg-zinc-800 transition-colors flex items-center justify-center text-zinc-500 hover:text-zinc-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {status === "idle" && (
              <button
                onClick={uploadAndAnalyze}
                className="w-full px-5 py-3.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-500 text-zinc-950 font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4" strokeWidth={2.5} />
                분석 시작
              </button>
            )}

            {status === "uploading" && (
              <div className="space-y-3">
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                      <span className="text-sm font-medium">업로드 중</span>
                    </div>
                    <span className="text-sm font-mono text-zinc-400">{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-400 to-cyan-500 transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {status === "analyzing" && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-400/10 mb-4">
                  <Sparkles className="w-5 h-5 text-emerald-400 animate-pulse" />
                </div>
                <p className="text-sm font-medium mb-1">AI가 영상을 분석하고 있어요</p>
                <p className="text-xs text-zinc-500">잠시만 기다려주세요...</p>
              </div>
            )}

            {status === "error" && (
              <div className="space-y-3">
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5 flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-300">오류 발생</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{errorMsg}</p>
                  </div>
                </div>
                <button onClick={reset} className="w-full px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-colors font-medium">
                  다시 시도
                </button>
              </div>
            )}
          </div>
        )}

        {/* 분석 완료 - 2단 레이아웃 (왼쪽: 영상+결과, 오른쪽: 챗봇) */}
        {status === "done" && result && file && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* 왼쪽: 영상 + 분석 결과 */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="aspect-video bg-black">
                  {preview && (
                    <video src={preview} controls className="w-full h-full object-contain" />
                  )}
                </div>
                <div className="p-4 border-t border-zinc-800">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-medium text-emerald-300">분석 완료</span>
                  </div>
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-zinc-500">{formatBytes(file.size)}</p>
                </div>
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-zinc-400 mb-3 uppercase tracking-wider">
                  분석 결과
                </h3>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">길이</span>
                    <span className="font-mono">{result.duration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">장면 수</span>
                    <span className="font-mono">{result.analysis.scenes}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">신뢰도</span>
                    <span className="font-mono text-emerald-400">
                      {(result.analysis.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="pt-2 border-t border-zinc-800">
                    <p className="text-xs text-zinc-500 mb-2">감지된 객체</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.analysis.objects.map((obj: string) => (
                        <span
                          key={obj}
                          className="text-xs px-2 py-1 rounded-md bg-zinc-800 text-zinc-300"
                        >
                          {obj}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 오른쪽: 챗봇 */}
            <div className="lg:col-span-3">
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl flex flex-col h-[calc(100vh-220px)] min-h-[500px]">
                {/* 챗봇 헤더 */}
                <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-zinc-950" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">AI 어시스턴트</p>
                    <p className="text-xs text-zinc-500">영상에 대해 무엇이든 물어보세요</p>
                  </div>
                </div>

                {/* 메시지 영역 */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          msg.role === "user"
                            ? "bg-zinc-800"
                            : "bg-gradient-to-br from-emerald-400/20 to-cyan-500/20"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <User className="w-4 h-4 text-zinc-300" />
                        ) : (
                          <Bot className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>
                      <div
                        className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                          msg.role === "user"
                            ? "bg-gradient-to-br from-emerald-400 to-cyan-500 text-zinc-950 font-medium rounded-tr-sm"
                            : msg.isError
                            ? "bg-red-500/10 border border-red-500/20 text-red-300 rounded-tl-sm"
                            : "bg-zinc-800 text-zinc-100 rounded-tl-sm"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}

                  {isChatLoading && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400/20 to-cyan-500/20 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="bg-zinc-800 px-4 py-3 rounded-2xl rounded-tl-sm">
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 추천 질문 (첫 메시지 후에만 표시) */}
                  {messages.length === 1 && !isChatLoading && (
                    <div className="pt-2">
                      <p className="text-xs text-zinc-500 mb-2 px-1">추천 질문</p>
                      <div className="flex flex-wrap gap-2">
                        {suggestedQuestions.map((q) => (
                          <button
                            key={q}
                            onClick={() => {
                              setChatInput(q);
                              chatInputRef.current?.focus();
                            }}
                            className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors text-zinc-300 border border-zinc-700"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                {/* 입력 영역 */}
                <div className="border-t border-zinc-800 p-4">
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="영상에 대해 질문해보세요..."
                      disabled={isChatLoading}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/20 disabled:opacity-50 placeholder:text-zinc-500"
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || isChatLoading}
                      className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-zinc-950 flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                    >
                      <Send className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 에러 (파일 선택 전) */}
        {!file && status === "error" && (
          <div className="mt-4 bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center gap-3 max-w-3xl mx-auto">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{errorMsg}</p>
          </div>
        )}
      </main>
    </div>
  );
}