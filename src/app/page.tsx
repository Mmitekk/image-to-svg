'use client';

import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload,
  Image as ImageIcon,
  Download,
  Trash2,
  Settings2,
  Code2,
  Eye,
  Wand2,
  Palette,
  Eraser,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Copy,
  Check,
  FileImage,
  Loader2,
  Sparkles,
  Layers,
  PenTool,
} from 'lucide-react';

type TraceMode = 'icon' | 'detailed' | 'poster';

interface ConvertOptions {
  mode: TraceMode;
  removeBg: boolean;
  bgColorTolerance: number;
  numberOfColors: number;
  scale: number;
  strokeWidth: number;
  blurRadius: number;
  pathOmit: number;
  ltres: number;
  qtres: number;
  roundcoords: number;
  turdSize: number;
  alphaMax: number;
  optCurve: boolean;
  cornerThreshold: number;
}

const modePresets: Record<TraceMode, Partial<ConvertOptions> & { label: string; description: string; icon: React.ReactNode }> = {
  icon: {
    label: 'Иконка',
    description: 'Чистый монохромный контур с бинарным порогом. Идеально для иконок и логотипов.',
    icon: <PenTool className="w-4 h-4" />,
    numberOfColors: 2,
    pathOmit: 8,
    strokeWidth: 0,
    ltres: 1.0,
    qtres: 1.0,
    roundcoords: 2,
    turdSize: 5,
    alphaMax: 1,
    optCurve: true,
    cornerThreshold: 1,
  },
  poster: {
    label: 'Плакат',
    description: 'Цветные слои с плавными контурами. Хорошо для иллюстраций.',
    icon: <Layers className="w-4 h-4" />,
    numberOfColors: 8,
    pathOmit: 12,
    strokeWidth: 0,
    ltres: 1.0,
    qtres: 1.0,
    roundcoords: 2,
    turdSize: 3,
    alphaMax: 1,
    optCurve: true,
    cornerThreshold: 1,
  },
  detailed: {
    label: 'Детальная',
    description: 'Максимальная детализация цвета с плавными кривыми. Для фотографий и сложных изображений.',
    icon: <Sparkles className="w-4 h-4" />,
    numberOfColors: 32,
    pathOmit: 5,
    strokeWidth: 0,
    ltres: 0.8,
    qtres: 0.8,
    roundcoords: 2,
    turdSize: 2,
    alphaMax: 1,
    optCurve: true,
    cornerThreshold: 1,
  },
};

const defaultOptions: ConvertOptions = {
  mode: 'poster',
  removeBg: false,
  bgColorTolerance: 0.15,
  numberOfColors: 8,
  scale: 1,
  strokeWidth: 0,
  blurRadius: 0,
  pathOmit: 12,
  ltres: 1.0,
  qtres: 1.0,
  roundcoords: 2,
  turdSize: 3,
  alphaMax: 1,
  optCurve: true,
  cornerThreshold: 1,
};

export default function Home() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [originalFileName, setOriginalFileName] = useState<string>('');
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [editedSvgContent, setEditedSvgContent] = useState<string>('');
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [options, setOptions] = useState<ConvertOptions>(defaultOptions);
  const [showSettings, setShowSettings] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('preview');
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [imageFileSize, setImageFileSize] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadedFileRef = useRef<File | null>(null);

  const handleModeChange = useCallback((mode: TraceMode) => {
    const preset = modePresets[mode];
    setOptions((prev) => ({
      ...prev,
      mode,
      numberOfColors: preset.numberOfColors ?? prev.numberOfColors,
      pathOmit: preset.pathOmit ?? prev.pathOmit,
      strokeWidth: preset.strokeWidth ?? prev.strokeWidth,
      ltres: preset.ltres ?? prev.ltres,
      qtres: preset.qtres ?? prev.qtres,
      roundcoords: preset.roundcoords ?? prev.roundcoords,
      turdSize: preset.turdSize ?? prev.turdSize,
      alphaMax: preset.alphaMax ?? prev.alphaMax,
      optCurve: preset.optCurve ?? prev.optCurve,
      cornerThreshold: preset.cornerThreshold ?? prev.cornerThreshold,
    }));
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      return;
    }

    setErrorMessage('');
    setImageFileSize(file.size);
    setOriginalFileName(file.name.replace(/\.[^/.]+$/, ''));
    uploadedFileRef.current = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      setOriginalImage(e.target?.result as string);
      convertToSvg(file);
    };
    reader.readAsDataURL(file);
  }, [options]);

  const convertToSvg = useCallback(
    async (file?: File) => {
      const inputFile = file || uploadedFileRef.current;
      if (!inputFile) return;

      setIsConverting(true);
      setErrorMessage('');
      setProgress(10);

      try {
        setProgress(30);
        const formData = new FormData();
        formData.append('image', inputFile);
        formData.append('options', JSON.stringify(options));

        setProgress(50);
        const response = await fetch('/api/convert', {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(120000), // 2 minute timeout
        });

        setProgress(80);

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Conversion failed');
        }

        const result = await response.json();
        setProgress(100);

        setSvgContent(result.svg);
        setEditedSvgContent(result.svg);
        setSvgDimensions({ width: result.width, height: result.height });
        setActiveTab('preview');
      } catch (error) {
        console.error('Conversion error:', error);
        const msg = error instanceof Error ? error.message : 'Ошибка конвертации';
        setErrorMessage(msg);
      } finally {
        setIsConverting(false);
        setTimeout(() => setProgress(0), 1000);
      }
    },
    [options]
  );

  const handleReconvert = useCallback(() => {
    convertToSvg();
  }, [convertToSvg]);

  const handleDownload = useCallback(() => {
    const svgToDownload = editedSvgContent || svgContent;
    if (!svgToDownload) return;

    const blob = new Blob([svgToDownload], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${originalFileName || 'icon'}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [editedSvgContent, svgContent, originalFileName]);

  const handleCopySvg = useCallback(async () => {
    const svgToCopy = editedSvgContent || svgContent;
    if (!svgToCopy) return;

    await navigator.clipboard.writeText(svgToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [editedSvgContent, svgContent]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleReset = useCallback(() => {
    setOriginalImage(null);
    setSvgContent(null);
    setEditedSvgContent('');
    setOriginalFileName('');
    setImageFileSize(0);
    setErrorMessage('');
    setZoom(1);
    setActiveTab('preview');
    uploadedFileRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const currentMode = modePresets[options.mode];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 dark:bg-gray-950/80 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Palette className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                SVG Icon Generator
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                Конвертация PNG/JPEG в редактируемый SVG
              </p>
            </div>
          </div>

          {svgContent && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopySvg}
                className="gap-1.5"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">{copied ? 'Скопировано' : 'Копировать'}</span>
              </Button>
              <Button
                size="sm"
                onClick={handleDownload}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Скачать SVG</span>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Panel - Upload & Settings */}
          <div className="lg:col-span-4 space-y-4">
            {/* Upload Area */}
            <Card className="border-0 shadow-lg shadow-gray-200/50 dark:shadow-gray-900/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                  <FileImage className="w-4 h-4" />
                  Исходное изображение
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!originalImage ? (
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                    className={`
                      relative cursor-pointer border-2 border-dashed rounded-xl p-8 text-center
                      transition-all duration-200
                      ${
                        isDragging
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 scale-[1.02]'
                          : 'border-gray-300 dark:border-gray-700 hover:border-emerald-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }
                    `}
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/50 dark:to-teal-900/50 flex items-center justify-center">
                        <Upload className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Перетащите изображение сюда
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          или нажмите для выбора файла
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        PNG, JPEG
                      </Badge>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                      }}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative rounded-xl overflow-hidden bg-[repeating-conic-gradient(#e5e7eb_0%_25%,transparent_0%_50%)] dark:bg-[repeating-conic-gradient(#374151_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] border border-gray-200 dark:border-gray-700">
                      <img
                        src={originalImage}
                        alt="Original"
                        className="w-full h-auto max-h-64 object-contain"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500 space-y-0.5">
                        <p className="font-medium text-gray-700 dark:text-gray-300 truncate max-w-[180px]">
                          {originalFileName}
                        </p>
                        <p>{formatFileSize(imageFileSize)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleReset}
                        className="h-8 w-8 text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Settings */}
            <Card className="border-0 shadow-lg shadow-gray-200/50 dark:shadow-gray-900/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                    <Settings2 className="w-4 h-4" />
                    Настройки конвертации
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSettings(!showSettings)}
                    className="h-7 text-xs"
                  >
                    {showSettings ? 'Скрыть' : 'Подробнее'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Mode Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Режим конвертации</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['icon', 'poster', 'detailed'] as TraceMode[]).map((mode) => {
                      const preset = modePresets[mode];
                      const isActive = options.mode === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => handleModeChange(mode)}
                          className={`
                            flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all duration-200 text-center
                            ${
                              isActive
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 shadow-sm'
                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                            }
                          `}
                        >
                          <div className={`${
                            isActive ? 'text-emerald-600' : 'text-gray-400'
                          }`}>
                            {preset.icon}
                          </div>
                          <span className={`text-xs font-medium ${
                            isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-400'
                          }`}>
                            {preset.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {currentMode.description}
                  </p>
                </div>

                <Separator />

                {/* Background Removal */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center gap-2">
                    <Eraser className="w-4 h-4 text-emerald-600" />
                    <Label htmlFor="removeBg" className="text-sm cursor-pointer">
                      Удалить фон
                    </Label>
                  </div>
                  <Switch
                    id="removeBg"
                    checked={options.removeBg}
                    onCheckedChange={(checked) =>
                      setOptions((prev) => ({ ...prev, removeBg: checked }))
                    }
                  />
                </div>

                {options.removeBg && (
                  <div className="space-y-2 pl-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-gray-500">Чувствительность фона</Label>
                      <span className="text-xs font-mono text-gray-400">
                        {Math.round(options.bgColorTolerance * 100)}%
                      </span>
                    </div>
                    <Slider
                      value={[options.bgColorTolerance * 100]}
                      onValueChange={([v]) =>
                        setOptions((prev) => ({ ...prev, bgColorTolerance: v / 100 }))
                      }
                      min={5}
                      max={50}
                      step={1}
                      className="py-2"
                    />
                  </div>
                )}

                {/* Number of Colors (not for icon mode) */}
                {options.mode !== 'icon' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm flex items-center gap-1.5">
                        <Palette className="w-3.5 h-3.5" />
                        Количество цветов
                      </Label>
                      <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                        {options.numberOfColors}
                      </span>
                    </div>
                    <Slider
                      value={[options.numberOfColors]}
                      onValueChange={([v]) =>
                        setOptions((prev) => ({ ...prev, numberOfColors: v }))
                      }
                      min={2}
                      max={options.mode === 'poster' ? 12 : 64}
                      step={1}
                    />
                  </div>
                )}

                {/* Scale */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Масштаб</Label>
                    <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                      {options.scale}x
                    </span>
                  </div>
                  <Slider
                    value={[options.scale * 100]}
                    onValueChange={([v]) =>
                      setOptions((prev) => ({ ...prev, scale: v / 100 }))
                    }
                    min={50}
                    max={400}
                    step={25}
                  />
                </div>

                {showSettings && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Расширенные
                      </p>

                      {/* Potrace-specific settings */}
                      {(options.mode === 'icon' || options.mode === 'poster') && (
                        <>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-500">Мин. размер пятна (turd)</Label>
                              <span className="text-xs font-mono text-gray-400">{options.turdSize}</span>
                            </div>
                            <Slider
                              value={[options.turdSize]}
                              onValueChange={([v]) =>
                                setOptions((prev) => ({ ...prev, turdSize: v }))
                              }
                              min={1}
                              max={100}
                              step={1}
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-500">Сглаживание углов</Label>
                              <span className="text-xs font-mono text-gray-400">{options.alphaMax}</span>
                            </div>
                            <Slider
                              value={[options.alphaMax * 100]}
                              onValueChange={([v]) =>
                                setOptions((prev) => ({ ...prev, alphaMax: v / 100 }))
                              }
                              min={0}
                              max={134}
                              step={1}
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-500">Порог углов</Label>
                              <span className="text-xs font-mono text-gray-400">{options.cornerThreshold}</span>
                            </div>
                            <Slider
                              value={[options.cornerThreshold * 100]}
                              onValueChange={([v]) =>
                                setOptions((prev) => ({ ...prev, cornerThreshold: v / 100 }))
                              }
                              min={0}
                              max={100}
                              step={1}
                            />
                          </div>

                          <div className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                            <Label className="text-xs text-gray-500">Оптимизация кривых</Label>
                            <Switch
                              checked={options.optCurve}
                              onCheckedChange={(v) =>
                                setOptions((prev) => ({ ...prev, optCurve: v }))
                              }
                            />
                          </div>
                        </>
                      )}

                      {/* Imagetracer-specific settings (detailed mode) */}
                      {options.mode === 'detailed' && (
                        <>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-500">Радиус размытия</Label>
                              <span className="text-xs font-mono text-gray-400">{options.blurRadius}</span>
                            </div>
                            <Slider
                              value={[options.blurRadius]}
                              onValueChange={([v]) =>
                                setOptions((prev) => ({ ...prev, blurRadius: v }))
                              }
                              min={0}
                              max={5}
                              step={1}
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-500">Точность линий</Label>
                              <span className="text-xs font-mono text-gray-400">{options.ltres}</span>
                            </div>
                            <Slider
                              value={[options.ltres * 100]}
                              onValueChange={([v]) =>
                                setOptions((prev) => ({ ...prev, ltres: v / 100 }))
                              }
                              min={5}
                              max={500}
                              step={5}
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-500">Точность кривых</Label>
                              <span className="text-xs font-mono text-gray-400">{options.qtres}</span>
                            </div>
                            <Slider
                              value={[options.qtres * 100]}
                              onValueChange={([v]) =>
                                setOptions((prev) => ({ ...prev, qtres: v / 100 }))
                              }
                              min={5}
                              max={500}
                              step={5}
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-500">Мин. размер пути</Label>
                              <span className="text-xs font-mono text-gray-400">{options.pathOmit}</span>
                            </div>
                            <Slider
                              value={[options.pathOmit]}
                              onValueChange={([v]) =>
                                setOptions((prev) => ({ ...prev, pathOmit: v }))
                              }
                              min={0}
                              max={100}
                              step={1}
                            />
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-gray-500">Толщина обводки</Label>
                              <span className="text-xs font-mono text-gray-400">{options.strokeWidth}</span>
                            </div>
                            <Slider
                              value={[options.strokeWidth * 10]}
                              onValueChange={([v]) =>
                                setOptions((prev) => ({ ...prev, strokeWidth: v / 10 }))
                              }
                              min={0}
                              max={50}
                              step={5}
                            />
                          </div>
                        </>
                      )}

                      {/* Common: roundcoords */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-gray-500">Округление координат</Label>
                          <span className="text-xs font-mono text-gray-400">{options.roundcoords}</span>
                        </div>
                        <Slider
                          value={[options.roundcoords]}
                          onValueChange={([v]) =>
                            setOptions((prev) => ({ ...prev, roundcoords: v }))
                          }
                          min={0}
                          max={5}
                          step={1}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Convert Button */}
                <Button
                  onClick={handleReconvert}
                  disabled={!originalImage || isConverting}
                  className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20"
                  size="lg"
                >
                  {isConverting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Wand2 className="w-5 h-5" />
                  )}
                  {isConverting ? 'Конвертация...' : 'Конвертировать в SVG'}
                </Button>

                {isConverting && (
                  <Progress value={progress} className="h-1.5" />
                )}

                {errorMessage && (
                  <div className="mt-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs">
                    {errorMessage}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - SVG Output & Editor */}
          <div className="lg:col-span-8">
            <Card className="border-0 shadow-lg shadow-gray-200/50 dark:shadow-gray-900/50 min-h-[600px]">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    Результат
                  </CardTitle>
                  {svgContent && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                        className="h-8 w-8"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </Button>
                      <span className="text-xs font-mono text-gray-400 w-12 text-center">
                        {Math.round(zoom * 100)}%
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                        className="h-8 w-8"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setZoom(1)}
                        className="h-8 w-8"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!svgContent ? (
                  <div className="flex flex-col items-center justify-center h-[500px] text-gray-400 dark:text-gray-600">
                    <div className="w-20 h-20 rounded-3xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                      <ImageIcon className="w-10 h-10" />
                    </div>
                    <p className="text-sm font-medium">Загрузите изображение</p>
                    <p className="text-xs mt-1">
                      PNG или JPEG для конвертации в SVG
                    </p>
                  </div>
                ) : (
                  <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="mb-4">
                      <TabsTrigger value="preview" className="gap-1.5">
                        <Eye className="w-3.5 h-3.5" />
                        Превью
                      </TabsTrigger>
                      <TabsTrigger value="editor" className="gap-1.5">
                        <Code2 className="w-3.5 h-3.5" />
                        Редактор SVG
                      </TabsTrigger>
                      <TabsTrigger value="compare" className="gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5" />
                        Сравнение
                      </TabsTrigger>
                    </TabsList>

                    {/* Preview Tab */}
                    <TabsContent value="preview" className="mt-0">
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
                        <div
                          className="flex items-center justify-center p-6 min-h-[480px] overflow-auto"
                          style={{
                            background:
                              'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)',
                          }}
                        >
                          <div
                            style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                            className="transition-transform duration-200 [&>svg]:max-w-full [&>svg]:max-h-[460px] [&>svg]:h-auto [&>svg]:w-auto"
                            dangerouslySetInnerHTML={{ __html: editedSvgContent }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                        <Badge variant="outline">
                          {options.mode === 'icon' ? 'Иконка' : options.mode === 'poster' ? 'Плакат' : 'Детальная'}
                        </Badge>
                        <span>
                          {svgDimensions.width} × {svgDimensions.height} px
                        </span>
                        <span>
                          {(editedSvgContent.length / 1024).toFixed(1)} KB
                        </span>
                        <span>
                          {editedSvgContent.split('<path').length - 1} путей
                        </span>
                      </div>
                    </TabsContent>

                    {/* Editor Tab */}
                    <TabsContent value="editor" className="mt-0">
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {/* Code Editor */}
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-500">
                              SVG код
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleCopySvg}
                              className="h-6 text-xs gap-1"
                            >
                              {copied ? (
                                <Check className="w-3 h-3 text-emerald-500" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              Копировать
                            </Button>
                          </div>
                          <textarea
                            value={editedSvgContent}
                            onChange={(e) => setEditedSvgContent(e.target.value)}
                            className="w-full h-[440px] p-3 font-mono text-xs leading-relaxed bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-200 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                            spellCheck={false}
                          />
                        </div>

                        {/* Live Preview */}
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                            <span className="text-xs font-medium text-gray-500">
                              Превью (живое)
                            </span>
                          </div>
                          <div
                            className="flex items-center justify-center p-6 h-[440px] overflow-auto"
                            style={{
                              background:
                                'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)',
                            }}
                          >
                            <div
                              style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                              className="transition-transform duration-200 [&>svg]:max-w-full [&>svg]:max-h-[420px] [&>svg]:h-auto [&>svg]:w-auto"
                              dangerouslySetInnerHTML={{ __html: editedSvgContent }}
                            />
                          </div>
                        </div>
                      </div>
                    </TabsContent>

                    {/* Compare Tab */}
                    <TabsContent value="compare" className="mt-0">
                      <div className="grid grid-cols-2 gap-4">
                        {/* Original */}
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                            <span className="text-xs font-medium text-gray-500">
                              Оригинал
                            </span>
                          </div>
                          <div
                            className="flex items-center justify-center p-6 h-[440px]"
                            style={{
                              background:
                                'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)',
                            }}
                          >
                            {originalImage && (
                              <img
                                src={originalImage}
                                alt="Original"
                                className="max-w-full max-h-full object-contain"
                              />
                            )}
                          </div>
                        </div>

                        {/* SVG */}
                        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                            <span className="text-xs font-medium text-gray-500">
                              SVG результат
                            </span>
                          </div>
                          <div
                            className="flex items-center justify-center p-6 h-[440px]"
                            style={{
                              background:
                                'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)',
                            }}
                          >
                            <div
                              style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                              className="transition-transform duration-200 [&>svg]:max-w-full [&>svg]:max-h-[420px] [&>svg]:h-auto [&>svg]:w-auto"
                              dangerouslySetInnerHTML={{ __html: editedSvgContent }}
                            />
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
