import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Button,
  Input,
  Label,
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
  generateInvitationCard,
  CURATED_FONTS,
} from '@agent-system/shared-ui';
import type { InvitationCardData } from '@agent-system/shared-ui';
import type { CardTemplate } from '@agent-system/shared-types';
import { DEFAULT_CARD_TEMPLATE, DEFAULT_COMPANY_BRANDING } from '@agent-system/shared-types';
import { useSystemSettings, useUpdateCardTemplate } from '../hooks/useSystemSettings';
import { ArrowLeft, ArrowUp, ArrowDown, RotateCcw, Download, Save } from 'lucide-react';

const SAMPLE_DATA: InvitationCardData = {
  inviteeName: 'John Doe',
  campaignName: 'Q1 Recruitment Drive',
  venue: 'Marina Bay Sands Convention Centre',
  dayOfWeek: 'Sat',
  slotDate: '2026-03-15T09:00:00+08:00',
  startTime: '09:00',
  endTime: '12:00',
  uniqueToken: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  registrationId: 'sample-reg-001',
  registrationUrl: 'https://example.com/register/sample',
  isAutoCard: true,
};

const VISIBLE_ELEMENT_LABELS: Record<string, string> = {
  logo: 'Company Logo',
  subtitle: 'Subtitle',
  date: 'Date Panel',
  campaign: 'Campaign Name',
  venue: 'Venue',
  qr: 'QR Code',
  invitee: 'Invitee Name',
  instruction: 'Instruction Text',
  reference: 'Reference Token',
};

export function CardTemplateEditor() {
  const { data: systemSettings, isLoading } = useSystemSettings();
  const updateTemplate = useUpdateCardTemplate();
  const { toast } = useToast();

  const [formState, setFormState] = useState<CardTemplate>(DEFAULT_CARD_TEMPLATE);
  const [previewMode, setPreviewMode] = useState<'auto' | 'manual'>('auto');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (systemSettings?.card_template) {
      setFormState(systemSettings.card_template);
    }
  }, [systemSettings]);

  const branding = systemSettings?.company_branding ?? DEFAULT_COMPANY_BRANDING;

  const renderPreview = useCallback(async () => {
    try {
      const effectiveData = { ...SAMPLE_DATA, isAutoCard: previewMode === 'auto' };
      const doc = await generateInvitationCard(effectiveData, formState, branding);
      const pdfBlob = doc.output('blob');
      const url = URL.createObjectURL(pdfBlob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch {
      // Preview generation failed silently
    }
  }, [formState, branding, previewMode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(renderPreview, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [renderPreview]);

  const updateField = <K extends keyof CardTemplate>(key: K, value: CardTemplate[K]) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const toggleVisibleElement = (element: string) => {
    setFormState((prev) => ({
      ...prev,
      visibleElements: prev.visibleElements.includes(element)
        ? prev.visibleElements.filter((e) => e !== element)
        : [...prev.visibleElements, element],
    }));
  };

  const moveElement = (index: number, direction: 'up' | 'down') => {
    setFormState((prev) => {
      const newOrder = [...prev.elementOrder];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newOrder.length) return prev;
      [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
      return { ...prev, elementOrder: newOrder };
    });
  };

  const handleSave = async () => {
    try {
      await updateTemplate.mutateAsync(formState);
      toast({ title: 'Template saved', description: 'Card template has been updated.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to save template.', variant: 'destructive' });
    }
  };

  const handleReset = () => {
    setFormState(DEFAULT_CARD_TEMPLATE);
    toast({ title: 'Reset', description: 'Template reset to defaults.' });
  };

  const handleDownload = async () => {
    try {
      const effectiveData = { ...SAMPLE_DATA, isAutoCard: previewMode === 'auto' };
      const doc = await generateInvitationCard(effectiveData, formState, branding);
      doc.save('sample-invitation-card.pdf');
    } catch {
      toast({ title: 'Error', description: 'Failed to generate PDF.', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 p-6 border-b">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Card Template Editor</h1>
          <p className="text-sm text-muted-foreground">Customize the invitation card design</p>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - Form */}
        <div className="w-[380px] border-r overflow-y-auto p-4">
          <Tabs defaultValue="colors">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="colors">Colors</TabsTrigger>
              <TabsTrigger value="typography">Type</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="layout">Layout</TabsTrigger>
            </TabsList>

            {/* Colors Tab */}
            <TabsContent value="colors" className="space-y-4 mt-4">
              <ColorField label="Auto Card Color" value={formState.autoCardColor} onChange={(v) => updateField('autoCardColor', v)} />
              <ColorField label="Manual Card Color" value={formState.manualCardColor} onChange={(v) => updateField('manualCardColor', v)} />
              <ColorField label="Panel Text Color" value={formState.panelTextColor} onChange={(v) => updateField('panelTextColor', v)} />
              <ColorField label="Accent Color" value={formState.accentColor} onChange={(v) => updateField('accentColor', v)} />
              <ColorField label="QR Code Color" value={formState.qrColor} onChange={(v) => updateField('qrColor', v)} />
              <div className="space-y-2">
                <Label>QR Size: {formState.qrSize}mm</Label>
                <input
                  type="range"
                  min={15}
                  max={35}
                  value={formState.qrSize}
                  onChange={(e) => updateField('qrSize', Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </TabsContent>

            {/* Typography Tab */}
            <TabsContent value="typography" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Font Family</Label>
                <Select value={formState.fontFamily} onValueChange={(v) => updateField('fontFamily', v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURATED_FONTS.map((font) => (
                      <SelectItem key={font.value} value={font.value}>
                        {font.name} - {font.style}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Title Font Size: {formState.titleFontSize}pt</Label>
                <Input
                  type="number"
                  min={8}
                  max={24}
                  value={formState.titleFontSize}
                  onChange={(e) => updateField('titleFontSize', Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Body Font Size: {formState.bodyFontSize}pt</Label>
                <Input
                  type="number"
                  min={6}
                  max={16}
                  value={formState.bodyFontSize}
                  onChange={(e) => updateField('bodyFontSize', Number(e.target.value))}
                />
              </div>
            </TabsContent>

            {/* Content Tab */}
            <TabsContent value="content" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Subtitle</Label>
                <Input
                  value={formState.subtitle}
                  onChange={(e) => updateField('subtitle', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Instruction Text</Label>
                <Input
                  value={formState.instructionText}
                  onChange={(e) => updateField('instructionText', e.target.value)}
                />
              </div>
            </TabsContent>

            {/* Layout Tab */}
            <TabsContent value="layout" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Visible Elements</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {Object.entries(VISIBLE_ELEMENT_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center space-x-2">
                      <Checkbox
                        id={`visible-${key}`}
                        checked={formState.visibleElements.includes(key)}
                        onCheckedChange={() => toggleVisibleElement(key)}
                      />
                      <Label htmlFor={`visible-${key}`} className="text-sm">{label}</Label>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Element Order</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {formState.elementOrder.map((element, index) => (
                    <div key={element} className="flex items-center justify-between p-2 rounded border text-sm">
                      <span>{VISIBLE_ELEMENT_LABELS[element] ?? element}</span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => moveElement(index, 'up')}
                          disabled={index === 0}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => moveElement(index, 'down')}
                          disabled={index === formState.elementOrder.length - 1}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right panel - Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 p-4 border-b">
            <span className="text-sm font-medium">Preview:</span>
            <Button
              variant={previewMode === 'auto' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPreviewMode('auto')}
            >
              Auto Card
            </Button>
            <Button
              variant={previewMode === 'manual' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPreviewMode('manual')}
            >
              Manual Card
            </Button>
          </div>
          <div className="flex-1 bg-muted/50 flex items-center justify-center p-4">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                className="w-full max-w-[600px] h-full max-h-[500px] border rounded shadow-sm bg-white"
                title="Card Preview"
              />
            ) : (
              <p className="text-muted-foreground">Generating preview...</p>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between p-4 border-t bg-background">
        <Button variant="outline" onClick={handleReset}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset to Defaults
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download Sample PDF
          </Button>
          <Button onClick={handleSave} disabled={updateTemplate.isPending}>
            <Save className="h-4 w-4 mr-2" />
            {updateTemplate.isPending ? 'Saving...' : 'Save Template'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded border cursor-pointer"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 font-mono"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}
