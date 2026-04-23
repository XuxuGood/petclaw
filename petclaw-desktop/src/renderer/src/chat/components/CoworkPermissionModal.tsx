// 权限审批弹窗：支持标准工具审批、AskUserQuestion 确认、多选三种模式
import { useState } from 'react'
import { ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react'

type DangerLevel = 'safe' | 'caution' | 'destructive'

interface PermissionRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId?: string | null
}

interface PermissionResult {
  behavior: 'allow' | 'deny'
  updatedInput?: Record<string, unknown>
  message?: string
}

interface CoworkPermissionModalProps {
  permission: PermissionRequest
  onRespond: (result: PermissionResult) => void
}

// 危险命令检测：根据 toolInput 或命令内容判断危险等级
function detectDangerLevel(toolName: string, toolInput: Record<string, unknown>): DangerLevel {
  if (toolInput.dangerLevel === 'destructive') return 'destructive'
  if (toolInput.dangerLevel === 'caution') return 'caution'

  const command = String(toolInput.command ?? toolInput.input ?? '')

  const destructivePatterns = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)\b/i,
    /\bgit\s+push\s+.*--force\b/i,
    /\bgit\s+reset\s+--hard\b/i
  ]
  if (destructivePatterns.some((p) => p.test(command))) return 'destructive'

  const cautionPatterns = [
    /\b(rm|rmdir|del|trash)\b/i,
    /\bgit\s+push\b/i,
    /\b(kill|killall|pkill)\b/i,
    /\b(chmod|chown)\b/i,
    /\bsudo\b/i
  ]
  if (cautionPatterns.some((p) => p.test(command))) return 'caution'

  // toolName 本身未用到，避免 lint 警告
  void toolName

  return 'safe'
}

// 判断是否为 AskUserQuestion 确认模式（单问题 + 2 选项 + 非多选）
function isConfirmMode(toolInput: Record<string, unknown>): boolean {
  const questions = toolInput.questions as Array<Record<string, unknown>> | undefined
  if (!questions || questions.length !== 1) return false
  const q = questions[0]
  const options = q.options as unknown[] | undefined
  return options?.length === 2 && q.multiSelect !== true
}

// 判断是否为 AskUserQuestion 多选模式（多问题或非确认模式）
function isMultiQuestionMode(toolInput: Record<string, unknown>): boolean {
  if (toolInput.questions && !isConfirmMode(toolInput)) return true
  return false
}

const DANGER_STYLES: Record<
  DangerLevel,
  { bg: string; border: string; icon: typeof ShieldAlert; iconColor: string; label: string }
> = {
  safe: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: ShieldCheck,
    iconColor: 'text-green-600',
    label: '工具调用'
  },
  caution: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    icon: ShieldAlert,
    iconColor: 'text-yellow-600',
    label: '需要确认'
  },
  destructive: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: ShieldX,
    iconColor: 'text-red-600',
    label: '危险操作'
  }
}

export function CoworkPermissionModal({ permission, onRespond }: CoworkPermissionModalProps) {
  const { toolName, toolInput } = permission

  // AskUserQuestion 确认模式：单问题 2 选项
  if (toolName === 'AskUserQuestion' && isConfirmMode(toolInput)) {
    return <ConfirmModeModal toolInput={toolInput} onRespond={onRespond} />
  }

  // AskUserQuestion 多选模式：多问题或单问题多选
  if (toolName === 'AskUserQuestion' && isMultiQuestionMode(toolInput)) {
    return <MultiQuestionModal toolInput={toolInput} onRespond={onRespond} />
  }

  // 标准工具审批模式
  const dangerLevel = detectDangerLevel(toolName, toolInput)
  const style = DANGER_STYLES[dangerLevel]
  const DangerIcon = style.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[480px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 标题栏：危险等级色彩区分 */}
        <div className={`flex items-center gap-3 px-5 py-4 ${style.bg} border-b ${style.border}`}>
          <DangerIcon size={20} className={style.iconColor} />
          <span className="text-[14px] font-semibold text-text-primary">{style.label}</span>
          <div className="flex-1" />
          <button
            onClick={() => onRespond({ behavior: 'deny', message: '用户取消' })}
            className="p-1 rounded-[8px] hover:bg-black/5 transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        {/* 工具名称 + 参数展示 */}
        <div className="px-5 py-4 overflow-y-auto">
          <div className="mb-3">
            <span className="text-[12px] text-text-tertiary">工具名称</span>
            <div className="text-[14px] font-mono text-text-primary mt-1">{toolName}</div>
          </div>
          <div>
            <span className="text-[12px] text-text-tertiary">参数</span>
            <pre className="text-[12px] font-mono text-text-secondary mt-1 p-3 bg-bg-hover rounded-[10px] overflow-x-auto max-h-[200px]">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={() => onRespond({ behavior: 'deny', message: '用户拒绝' })}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-bg-hover text-text-secondary hover:bg-bg-active transition-colors active:scale-[0.96] duration-[120ms]"
          >
            拒绝
          </button>
          <button
            onClick={() => onRespond({ behavior: 'allow' })}
            className={`px-4 py-2 text-[13px] rounded-[10px] text-white transition-colors active:scale-[0.96] duration-[120ms] ${
              dangerLevel === 'destructive'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            允许
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 确认模式子组件：单问题 2 选项（不展示标题栏，直接显示问题文本）──

function ConfirmModeModal({
  toolInput,
  onRespond
}: {
  toolInput: Record<string, unknown>
  onRespond: (result: PermissionResult) => void
}) {
  const questions = toolInput.questions as Array<Record<string, unknown>>
  const q = questions[0]
  const options = q.options as Array<{ label: string; description?: string }>
  const questionText = String(q.question ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[420px] flex flex-col overflow-hidden">
        <div className="px-5 py-4">
          <p className="text-[14px] text-text-primary leading-[1.6]">{questionText}</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          {/* 第二个选项对应次要按钮（通常是"否/取消"语义）*/}
          <button
            onClick={() =>
              onRespond({
                behavior: 'allow',
                updatedInput: { ...toolInput, answers: { [questionText]: options[1].label } }
              })
            }
            className="px-4 py-2 text-[13px] rounded-[10px] bg-bg-hover text-text-secondary hover:bg-bg-active transition-colors active:scale-[0.96] duration-[120ms]"
          >
            {options[1].label}
          </button>
          {/* 第一个选项对应主要按钮（通常是"是/确认"语义）*/}
          <button
            onClick={() =>
              onRespond({
                behavior: 'allow',
                updatedInput: { ...toolInput, answers: { [questionText]: options[0].label } }
              })
            }
            className="px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms]"
          >
            {options[0].label}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 多选模式子组件：支持多问题 + 单选/多选混合 ──

function MultiQuestionModal({
  toolInput,
  onRespond
}: {
  toolInput: Record<string, unknown>
  onRespond: (result: PermissionResult) => void
}) {
  const questions = toolInput.questions as Array<Record<string, unknown>>
  // answers key 为 questionText，多选值用 ||| 分隔存储
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const handleSubmit = () => {
    onRespond({
      behavior: 'allow',
      updatedInput: { ...toolInput, answers }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[500px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {questions.map((q, qi) => {
            const questionText = String(q.question ?? '')
            const options = q.options as Array<{ label: string; description?: string }>
            const isMulti = q.multiSelect === true
            const currentAnswer = answers[questionText] ?? ''
            // 多选状态用 Set 管理，便于 O(1) 查找
            const selectedSet = new Set(currentAnswer.split('|||').filter(Boolean))

            return (
              <div key={qi} className="mb-5">
                <p className="text-[14px] font-medium text-text-primary mb-2">{questionText}</p>
                <div className="space-y-1.5">
                  {options.map((opt) => {
                    const isSelected = isMulti
                      ? selectedSet.has(opt.label)
                      : currentAnswer === opt.label

                    return (
                      <button
                        key={opt.label}
                        onClick={() => {
                          if (isMulti) {
                            // 多选：toggle 当前项
                            const next = new Set(selectedSet)
                            if (next.has(opt.label)) next.delete(opt.label)
                            else next.add(opt.label)
                            setAnswers((prev) => ({
                              ...prev,
                              [questionText]: Array.from(next).join('|||')
                            }))
                          } else {
                            // 单选：直接覆盖
                            setAnswers((prev) => ({
                              ...prev,
                              [questionText]: opt.label
                            }))
                          }
                        }}
                        className={`w-full text-left px-3 py-2 rounded-[10px] text-[13px] transition-colors duration-[120ms] ${
                          isSelected
                            ? 'bg-accent/10 text-accent border border-accent/30'
                            : 'bg-bg-hover text-text-secondary hover:bg-bg-active border border-transparent'
                        }`}
                      >
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <span className="text-text-tertiary ml-2">{opt.description}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={() => onRespond({ behavior: 'deny', message: '用户取消' })}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-bg-hover text-text-secondary hover:bg-bg-active transition-colors active:scale-[0.96] duration-[120ms]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-[13px] rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms]"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
