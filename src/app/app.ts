import { 
  Component, 
  signal, 
  computed, 
  ElementRef, 
  ViewChild, 
  AfterViewChecked, 
  inject, 
  OnInit 
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { Agentconnection, ChatMessage, MediaAttachment } from './services/agentconnection';

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  messages: ChatMessage[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, AfterViewChecked {
  @ViewChild('chatContainer') private chatContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('messageTextarea') private messageTextareaRef!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInputRef') private fileInputRef!: ElementRef<HTMLInputElement>;

  private readonly agentService = inject(Agentconnection);
  private readonly sanitizer = inject(DomSanitizer);

  readonly availableModels = [
    { id: 'minimax/minimax-m3:free', name: 'MiniMax: M3 (Free / Multimodal)' }
  ];
  readonly selectedModel = signal<string>('minimax/minimax-m3:free');
  readonly isDarkMode = signal<boolean>(true);

  // User Settings
  readonly apiKey = signal<string>('');
  readonly systemPrompt = signal<string>('You are a helpful, knowledgeable, and precise AI assistant.');
  
  // Chat State
  readonly chatSessions = signal<ChatSession[]>([]);
  readonly activeChatId = signal<string>('');
  readonly userInput = signal<string>('');
  
  // Attachments State
  readonly pendingAttachments = signal<MediaAttachment[]>([]);
  
  // UI Interactive States
  readonly isStreaming = signal<boolean>(false);
  readonly isSidebarCollapsed = signal<boolean>(false);
  readonly isMobileMenuOpen = signal<boolean>(false);
  readonly showSettingsModal = signal<boolean>(false);
  
  // Live Streaming States
  readonly liveAssistantContent = signal<string>('');
  readonly liveAssistantReasoning = signal<string>('');
  readonly isLiveReasoningOpen = signal<boolean>(true);
  readonly tokenTrackerText = signal<string>('Ready');

  // Settings Form Bindings
  tempApiKey = '';
  tempSystemPrompt = '';
  tempCustomModel = '';

  private shouldScrollToBottom = false;

  // Computed Properties
  readonly currentChat = computed(() => {
    return this.chatSessions().find(c => c.id === this.activeChatId());
  });

  readonly currentMessages = computed(() => {
    return this.currentChat()?.messages || [];
  });

  readonly isCurrentModelReasoning = computed(() => {
    const model = this.selectedModel();
    return model.includes('minimax') || model.includes('gemma') || model.includes('r1') || model.includes('reasoning');
  });

  ngOnInit(): void {
    this.configureMarked();
    this.loadTheme();
    this.loadStateFromStorage();
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  // --------------------------------------------------------------------------
  // Theme Management (Dark / White Theme)
  // --------------------------------------------------------------------------
  private loadTheme(): void {
    if (typeof window === 'undefined') return;
    const savedTheme = localStorage.getItem('app_theme');
    const isDark = savedTheme !== 'light';
    this.isDarkMode.set(isDark);
    this.applyThemeClass(isDark);
  }

  toggleTheme(): void {
    const nextDark = !this.isDarkMode();
    this.isDarkMode.set(nextDark);
    this.applyThemeClass(nextDark);
    if (typeof window !== 'undefined') {
      localStorage.setItem('app_theme', nextDark ? 'dark' : 'light');
    }
  }

  private applyThemeClass(isDark: boolean): void {
    if (typeof document !== 'undefined') {
      document.body.className = isDark ? 'dark-theme' : 'light-theme';
    }
  }

  // --------------------------------------------------------------------------
  // Media Attachments Handling (Text, Image, Video)
  // --------------------------------------------------------------------------
  triggerFileInput(): void {
    if (this.fileInputRef) {
      this.fileInputRef.nativeElement.click();
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    Array.from(input.files).forEach(file => {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');

      if (!isImage && !isVideo) {
        alert(`File ${file.name} is not a supported image or video format.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const attachment: MediaAttachment = {
          name: file.name,
          url: reader.result as string,
          type: isVideo ? 'video' : 'image',
          size: file.size
        };
        this.pendingAttachments.update(prev => [...prev, attachment]);
      };
      reader.readAsDataURL(file);
    });

    // Reset file input value so same file can be re-selected if removed
    input.value = '';
  }

  removePendingAttachment(index: number): void {
    this.pendingAttachments.update(prev => prev.filter((_, i) => i !== index));
  }

  // --------------------------------------------------------------------------
  // Markdown & Highlight Configuration
  // --------------------------------------------------------------------------
  private configureMarked(): void {
    const renderer = new marked.Renderer();
    
    renderer.code = ({ text, lang }) => {
      const language = lang || 'plaintext';
      let highlighted = '';
      try {
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(text, { language: lang }).value;
        } else {
          highlighted = hljs.highlightAuto(text).value;
        }
      } catch {
        highlighted = this.escapeHtml(text);
      }

      return `
        <div class="code-block-wrapper">
          <div class="code-header">
            <span class="code-lang">${this.escapeHtml(language)}</span>
            <button class="btn-copy-code" type="button" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(text)}')).then(() => { this.innerText = 'Copied!'; setTimeout(() => this.innerText = 'Copy', 2000); })">
              Copy
            </button>
          </div>
          <pre><code class="hljs ${language}">${highlighted}</code></pre>
        </div>
      `;
    };

    marked.setOptions({
      renderer: renderer,
      gfm: true,
      breaks: true
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  parseMarkdown(content: string): SafeHtml {
    if (!content) return '';
    const parsed = marked.parse(content) as string;
    return this.sanitizer.bypassSecurityTrustHtml(parsed);
  }

  // --------------------------------------------------------------------------
  // Storage & State
  // --------------------------------------------------------------------------
  private loadStateFromStorage(): void {
    if (typeof window === 'undefined') return;

    const savedKey = localStorage.getItem('openrouter_api_key');
    const savedPrompt = localStorage.getItem('openrouter_system_prompt');
    const savedChats = localStorage.getItem('openrouter_angular_chats');

    if (savedKey) this.apiKey.set(savedKey);
    if (savedPrompt) this.systemPrompt.set(savedPrompt);

    if (savedChats) {
      try {
        const chats: ChatSession[] = JSON.parse(savedChats);
        if (chats.length > 0) {
          this.chatSessions.set(chats);
          this.activeChatId.set(chats[0].id);
          this.selectedModel.set(chats[0].model || 'minimax/minimax-m3:free');
          return;
        }
      } catch (e) {
        console.error('Error loading chats from storage', e);
      }
    }

    this.newChat();
  }

  private saveChatsToStorage(): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem('openrouter_angular_chats', JSON.stringify(this.chatSessions()));
  }

  // --------------------------------------------------------------------------
  // Chat Actions
  // --------------------------------------------------------------------------
  newChat(): void {
    if (this.isStreaming()) return;

    const newSession: ChatSession = {
      id: 'chat_' + Date.now(),
      title: 'New Conversation',
      model: this.selectedModel(),
      createdAt: new Date().toISOString(),
      messages: []
    };

    this.chatSessions.update(prev => [newSession, ...prev]);
    this.activeChatId.set(newSession.id);
    this.pendingAttachments.set([]);
    this.saveChatsToStorage();
    this.isMobileMenuOpen.set(false);
  }

  switchChat(id: string): void {
    if (this.isStreaming()) return;
    this.activeChatId.set(id);
    const chat = this.currentChat();
    if (chat?.model) {
      this.selectedModel.set(chat.model);
    }
    this.isMobileMenuOpen.set(false);
    this.shouldScrollToBottom = true;
  }

  deleteChat(id: string, event: Event): void {
    event.stopPropagation();
    if (this.isStreaming()) return;

    this.chatSessions.update(prev => prev.filter(c => c.id !== id));
    if (this.activeChatId() === id) {
      const remaining = this.chatSessions();
      if (remaining.length > 0) {
        this.activeChatId.set(remaining[0].id);
      } else {
        this.newChat();
      }
    }
    this.saveChatsToStorage();
  }

  clearAllChats(): void {
    if (this.isStreaming()) return;
    if (confirm('Are you sure you want to clear all conversation history?')) {
      this.chatSessions.set([]);
      this.newChat();
    }
  }

  onModelChange(newModel: string): void {
    this.selectedModel.set(newModel);
    const chat = this.currentChat();
    if (chat) {
      chat.model = newModel;
      this.saveChatsToStorage();
    }
  }

  // --------------------------------------------------------------------------
  // Reasoning Box Toggle (Expand / Open)
  // --------------------------------------------------------------------------
  toggleLiveReasoning(): void {
    this.isLiveReasoningOpen.update(prev => !prev);
  }

  toggleMessageReasoning(msg: ChatMessage): void {
    msg.isReasoningOpen = !msg.isReasoningOpen;
    this.saveChatsToStorage();
  }

  // --------------------------------------------------------------------------
  // Send & Stream Message
  // --------------------------------------------------------------------------
  async sendMessage(promptText?: string): Promise<void> {
    const text = (promptText ?? this.userInput()).trim();
    const attachments = [...this.pendingAttachments()];

    if ((!text && attachments.length === 0) || this.isStreaming()) return;

    const currentKey = this.apiKey();
    if (!currentKey) {
      this.openSettings();
      alert('Please enter your OpenRouter API Key in Settings to begin chatting.');
      return;
    }

    const chat = this.currentChat();
    if (!chat) return;

    // Add user message with attachments
    const userMsg: ChatMessage = { 
      role: 'user', 
      content: text,
      attachments: attachments.length > 0 ? attachments : undefined
    };
    chat.messages.push(userMsg);
    
    if (chat.title === 'New Conversation') {
      const titleCandidate = text || (attachments.length > 0 ? `[${attachments[0].type}] attachment` : 'Conversation');
      chat.title = titleCandidate.slice(0, 32) + (titleCandidate.length > 32 ? '...' : '');
    }

    this.userInput.set('');
    this.pendingAttachments.set([]);
    this.saveChatsToStorage();
    this.shouldScrollToBottom = true;

    // Start streaming assistant response
    this.isStreaming.set(true);
    this.liveAssistantContent.set('');
    this.liveAssistantReasoning.set('');
    this.isLiveReasoningOpen.set(true);

    const messagesPayload: ChatMessage[] = [];
    if (this.systemPrompt()) {
      messagesPayload.push({ role: 'system', content: this.systemPrompt() });
    }
    chat.messages.forEach(m => {
      messagesPayload.push(m);
    });

    let finalUsage: any = null;

    await this.agentService.streamChat({
      messages: messagesPayload,
      model: this.selectedModel(),
      apiKey: currentKey,
      onChunk: (chunk) => {
        this.liveAssistantContent.update(prev => prev + chunk);
        this.shouldScrollToBottom = true;
      },
      onReasoning: (reasoning) => {
        this.liveAssistantReasoning.update(prev => prev + reasoning);
        this.shouldScrollToBottom = true;
      },
      onUsage: (usage) => {
        finalUsage = usage;
        const comp = usage.completion_tokens || 0;
        const reasoningTokens = usage.completionTokensDetails?.reasoningTokens || 0;
        if (reasoningTokens > 0) {
          this.tokenTrackerText.set(`${comp} tokens (${reasoningTokens} reasoning)`);
        } else if (comp > 0) {
          this.tokenTrackerText.set(`${comp} tokens`);
        }
      },
      onError: (err) => {
        const errorContent = err.message.startsWith('⚠️') ? err.message : `⚠️ **Error:** ${err.message}`;
        this.liveAssistantContent.update(prev => (prev ? prev + '\n\n' : '') + errorContent);
      },
      onComplete: () => {
        const content = this.liveAssistantContent();
        const reasoning = this.liveAssistantReasoning();
        
        chat.messages.push({
          role: 'assistant',
          content: content,
          reasoning: reasoning || undefined,
          isReasoningOpen: false,
          usage: finalUsage || undefined
        });

        this.liveAssistantContent.set('');
        this.liveAssistantReasoning.set('');
        this.isStreaming.set(false);
        this.saveChatsToStorage();
        this.shouldScrollToBottom = true;
      }
    });
  }

  stopStreaming(): void {
    this.agentService.stopGeneration();
  }

  // --------------------------------------------------------------------------
  // Settings Dialog
  // --------------------------------------------------------------------------
  openSettings(): void {
    this.tempApiKey = this.apiKey();
    this.tempSystemPrompt = this.systemPrompt();
    this.tempCustomModel = '';
    this.showSettingsModal.set(true);
  }

  closeSettings(): void {
    this.showSettingsModal.set(false);
  }

  saveSettings(): void {
    const key = this.tempApiKey.trim();
    const prompt = this.tempSystemPrompt.trim();
    const custom = this.tempCustomModel.trim();

    this.apiKey.set(key);
    this.systemPrompt.set(prompt);
    localStorage.setItem('openrouter_api_key', key);
    localStorage.setItem('openrouter_system_prompt', prompt);

    if (custom) {
      this.selectedModel.set(custom);
    }

    this.closeSettings();
  }

  // --------------------------------------------------------------------------
  // Navigation & Layout
  // --------------------------------------------------------------------------
  toggleSidebar(): void {
    this.isSidebarCollapsed.update(prev => !prev);
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen.update(prev => !prev);
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen.set(false);
  }

  onTextareaKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  scrollToBottom(): void {
    try {
      if (this.chatContainerRef) {
        this.chatContainerRef.nativeElement.scrollTop = this.chatContainerRef.nativeElement.scrollHeight;
      }
    } catch {}
  }
}
