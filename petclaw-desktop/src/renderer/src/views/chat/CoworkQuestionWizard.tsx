// 分步问答向导：多问题场景逐题展示，支持单选自动跳转、多选 toggle、"其他"自由输入
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'

import { useI18n } from '../../i18n'

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

interface CoworkQuestionWizardProps {
  permission: PermissionRequest
  onRespond: (result: PermissionResult) => void
}

interface QuestionOption {
  label: string
  description?: string
}

interface QuestionItem {
  question: string
  header?: string
  options: QuestionOption[]
  multiSelect?: boolean
}

export function CoworkQuestionWizard({ permission, onRespond }: CoworkQuestionWizardProps) {
  const { t } = useI18n()
  // useMemo 稳定引用，避免每次渲染产生新对象触发下游 hooks 重执行
  const toolInput = useMemo(() => permission.toolInput ?? {}, [permission.toolInput])

  // 从 toolInput.questions 安全解析问题列表
  const questions = useMemo<QuestionItem[]>(() => {
    if (permission.toolName !== 'AskUserQuestion') return []
    if (!toolInput || typeof toolInput !== 'object') return []
    const rawQuestions = (toolInput as Record<string, unknown>).questions
    if (!Array.isArray(rawQuestions)) return []

    return rawQuestions
      .map((question) => {
        if (!question || typeof question !== 'object') return null
        const record = question as Record<string, unknown>
        const options = Array.isArray(record.options)
          ? (record.options
              .map((option) => {
                if (!option || typeof option !== 'object') return null
                const optionRecord = option as Record<string, unknown>
                if (typeof optionRecord.label !== 'string') return null
                return {
                  label: optionRecord.label,
                  description:
                    typeof optionRecord.description === 'string'
                      ? optionRecord.description
                      : undefined
                } as QuestionOption
              })
              .filter(Boolean) as QuestionOption[])
          : []

        if (typeof record.question !== 'string' || options.length === 0) return null

        return {
          question: record.question,
          header: typeof record.header === 'string' ? record.header : undefined,
          options,
          multiSelect: Boolean(record.multiSelect)
        } as QuestionItem
      })
      .filter(Boolean) as QuestionItem[]
  }, [permission.toolName, toolInput])

  const [currentStep, setCurrentStep] = useState(0)
  // answers 以问题文本为 key，多选答案用 '|||' 分隔
  const [answers, setAnswers] = useState<Record<string, string>>({})
  // otherInputs 以步骤索引为 key，存储"其他"自由输入
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({})

  // 回填 toolInput 中已有的答案（重试场景）
  useEffect(() => {
    const rawAnswers = (toolInput as Record<string, unknown>).answers
    if (rawAnswers && typeof rawAnswers === 'object') {
      const initial: Record<string, string> = {}
      for (const [key, value] of Object.entries(rawAnswers as Record<string, unknown>)) {
        if (typeof value === 'string') initial[key] = value
      }
      setAnswers(initial)
    } else {
      setAnswers({})
    }
  }, [permission.requestId, toolInput])

  // Escape 关闭 → deny
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onRespond({ behavior: 'deny', message: t('permission.userCancel') })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onRespond, t])

  if (questions.length === 0) return null

  const currentQuestion = questions[currentStep]
  const totalSteps = questions.length
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === totalSteps - 1

  // 获取当前问题的已选值列表
  function getSelectedValues(question: QuestionItem): string[] {
    const rawValue = answers[question.question] ?? ''
    if (!rawValue) return []
    if (!question.multiSelect) return [rawValue]
    return rawValue
      .split('|||')
      .map((v) => v.trim())
      .filter(Boolean)
  }

  // 选项点击：单选自动 150ms 后跳转下一题，多选 toggle
  function handleSelectOption(question: QuestionItem, optionLabel: string) {
    if (!question.multiSelect) {
      setAnswers((prev) => ({ ...prev, [question.question]: optionLabel }))
      // 单选自动跳转，延迟以显示选中效果
      setTimeout(() => {
        setCurrentStep((prev) => {
          const next = prev + 1
          return next < questions.length ? next : prev
        })
      }, 150)
    } else {
      setAnswers((prev) => {
        const rawValue = prev[question.question] ?? ''
        if (!rawValue.trim()) {
          return { ...prev, [question.question]: optionLabel }
        }
        const current = new Set(
          rawValue
            .split('|||')
            .map((v) => v.trim())
            .filter(Boolean)
        )
        if (current.has(optionLabel)) {
          current.delete(optionLabel)
        } else {
          current.add(optionLabel)
        }
        if (current.size === 0) {
          const newAnswers = { ...prev }
          delete newAnswers[question.question]
          return newAnswers
        }
        return { ...prev, [question.question]: Array.from(current).join('|||') }
      })
    }
  }

  function handleOtherInputChange(value: string) {
    setOtherInputs((prev) => ({ ...prev, [currentStep]: value }))
  }

  function handlePrevious() {
    if (!isFirstStep) setCurrentStep((prev) => prev - 1)
  }

  function handleNext() {
    if (!isLastStep) setCurrentStep((prev) => prev + 1)
  }

  // 跳过：清空当前题答案和 other 输入，前进到下一题
  function handleSkip() {
    setAnswers((prev) => {
      const next = { ...prev }
      delete next[currentQuestion.question]
      return next
    })
    setOtherInputs((prev) => {
      const next = { ...prev }
      delete next[currentStep]
      return next
    })
    if (!isLastStep) handleNext()
  }

  // 提交：合并 other 输入到答案后回调 allow
  function handleSubmit() {
    const finalAnswers = { ...answers }
    for (const [stepIndex, otherValue] of Object.entries(otherInputs)) {
      const question = questions[Number(stepIndex)]
      if (question && otherValue.trim()) {
        if (question.multiSelect) {
          const existing =
            finalAnswers[question.question]
              ?.split('|||')
              .map((a) => a.trim())
              .filter(Boolean) ?? []
          finalAnswers[question.question] = [...existing, otherValue.trim()].join('|||')
        } else {
          finalAnswers[question.question] = otherValue.trim()
        }
      }
    }

    onRespond({
      behavior: 'allow',
      updatedInput: {
        ...(toolInput && typeof toolInput === 'object' ? toolInput : {}),
        answers: finalAnswers
      }
    })
  }

  function handleDeny() {
    onRespond({ behavior: 'deny', message: t('permission.userCancel') })
  }

  const selectedValues = getSelectedValues(currentQuestion)

  // 提交守卫：每个问题都需要有选项或 other 输入
  const allAnswered = questions.every((q, idx) => {
    const hasSelection = Boolean(answers[q.question]?.trim())
    const hasOther = Boolean(otherInputs[idx]?.trim())
    return hasSelection || hasOther
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
      <div className="bg-bg-root rounded-[14px] shadow-lg w-[560px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* 顶部进度条 */}
        <div className="h-1 bg-bg-hover">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
          />
        </div>

        {/* 标题栏 */}
        <div className="flex items-center px-5 py-4 border-b border-border">
          <span className="text-[14px] font-semibold text-text-primary">{t('wizard.title')}</span>
          <div className="flex-1" />
          <button
            onClick={handleDeny}
            className="p-1 rounded-[10px] hover:bg-bg-active transition-colors"
            aria-label="Close"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-5 py-5 min-h-[280px] flex flex-col overflow-y-auto">
          <div className="flex-1">
            {/* 问题头部和步骤导航 */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                {currentQuestion.header && (
                  <span className="inline-block text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-[10px] bg-bg-hover text-text-tertiary mb-2">
                    {currentQuestion.header}
                  </span>
                )}
                <h3 className="text-[14px] font-medium text-text-primary">
                  {currentQuestion.question}
                </h3>
              </div>

              {/* 步骤圆点导航 */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!isFirstStep && (
                  <button
                    onClick={handlePrevious}
                    className="p-1 rounded-[10px] text-text-primary hover:bg-bg-hover transition-colors active:scale-[0.96] duration-[120ms]"
                    title={t('wizard.previous')}
                  >
                    <ChevronLeft size={18} />
                  </button>
                )}

                {questions.map((question, index) => {
                  const isActive = index === currentStep
                  const isAnswered = Boolean(
                    answers[question.question]?.trim() || otherInputs[index]?.trim()
                  )
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setCurrentStep(index)}
                      className={`relative flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-medium transition-all active:scale-[0.96] duration-[120ms] ${
                        isActive
                          ? 'bg-accent text-white shadow-sm'
                          : isAnswered
                            ? 'bg-success/15 text-success border border-success/40 hover:scale-105'
                            : 'bg-bg-hover text-text-tertiary hover:bg-bg-active hover:scale-105'
                      }`}
                      title={question.question}
                    >
                      {isAnswered && !isActive ? <Check size={14} /> : index + 1}
                    </button>
                  )
                })}

                {!isLastStep && (
                  <button
                    onClick={handleNext}
                    className="p-1 rounded-[10px] text-text-primary hover:bg-bg-hover transition-colors active:scale-[0.96] duration-[120ms]"
                    title={t('wizard.next')}
                  >
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>
            </div>

            {/* 选项列表 */}
            <div className="space-y-1.5">
              {currentQuestion.options.map((option) => {
                const isSelected = selectedValues.includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => handleSelectOption(currentQuestion, option.label)}
                    className={`w-full text-left px-3 py-2.5 rounded-[10px] text-[13px] transition-colors duration-[120ms] flex items-start gap-3 ${
                      isSelected
                        ? 'bg-accent/10 text-accent border border-accent/30'
                        : 'bg-bg-hover text-text-secondary hover:bg-bg-active border border-transparent'
                    }`}
                  >
                    {/* radio/checkbox 指示器 */}
                    {currentQuestion.multiSelect ? (
                      <span
                        className={`w-4 h-4 rounded-[3px] border-2 flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors ${
                          isSelected ? 'border-accent bg-accent' : 'border-text-tertiary'
                        }`}
                      >
                        {isSelected && (
                          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M13 4L6 11L3 8"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    ) : (
                      <span
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 flex-shrink-0 transition-colors ${
                          isSelected ? 'border-accent' : 'border-text-tertiary'
                        }`}
                      >
                        {isSelected && <span className="w-2 h-2 rounded-full bg-accent" />}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{option.label}</span>
                      {option.description && (
                        <span className="text-text-tertiary ml-2 text-[12px]">
                          {option.description}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* "其他"输入 + 跳过按钮 */}
            <div className="mt-4 flex items-center gap-3">
              <input
                type="text"
                value={otherInputs[currentStep] || ''}
                onChange={(e) => handleOtherInputChange(e.target.value)}
                placeholder={t('wizard.other')}
                className="flex-1 px-3 py-2 rounded-[10px] border border-border-input bg-bg-input text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 text-[13px]"
              />
              <button
                type="button"
                onClick={handleSkip}
                className="px-4 py-2 text-[13px] font-medium rounded-[10px] text-text-secondary hover:bg-bg-hover transition-colors active:scale-[0.96] duration-[120ms] whitespace-nowrap"
              >
                {t('wizard.skip')}
              </button>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end px-5 py-4 border-t border-border">
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="px-5 py-2 text-[13px] font-medium rounded-[10px] bg-accent text-white hover:bg-accent-hover transition-colors active:scale-[0.96] duration-[120ms] disabled:opacity-50 disabled:cursor-not-allowed"
            title={!allAnswered ? t('wizard.answerRequired') : undefined}
          >
            {t('wizard.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
