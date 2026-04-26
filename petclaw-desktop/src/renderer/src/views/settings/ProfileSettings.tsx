import { useState, useEffect } from 'react'

// 职业角色选项
const ROLE_OPTIONS = ['软件工程师', '产品经理', '设计师', '数据分析师', '运营', '学生', '其他']

export function ProfileSettings() {
  const [nickname, setNickname] = useState('')
  const [role, setRole] = useState('')
  const [saved, setSaved] = useState(false)

  // 加载用户资料
  useEffect(() => {
    Promise.all([window.api.getSetting('nickname'), window.api.getSetting('role')]).then(
      ([nick, r]) => {
        if (nick) setNickname(nick)
        if (r) setRole(r)
      }
    )
  }, [])

  const handleSave = () => {
    Promise.all([
      window.api.setSetting('nickname', nickname),
      window.api.setSetting('role', role)
    ]).then(() => {
      // 短暂显示保存成功提示
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div>
      <h1 className="text-[20px] font-bold text-text-primary mb-1">个人资料</h1>
      <p className="text-[13px] text-text-tertiary mb-6">
        设置你的昵称和职业角色，帮助 AI 更好地了解你
      </p>

      <div className="rounded-[14px] bg-bg-card border border-border overflow-hidden mb-4">
        {/* 昵称 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <label className="text-[14px] text-text-primary font-medium">昵称</label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="输入你的昵称"
            className="w-[200px] px-3 py-1.5 rounded-[10px] bg-bg-input border-none text-[14px] text-text-primary outline-none placeholder:text-text-tertiary text-right"
          />
        </div>

        {/* 职业角色 */}
        <div className="flex items-center justify-between px-5 py-4">
          <label className="text-[14px] text-text-primary font-medium">职业角色</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-[200px] px-3 py-1.5 rounded-[10px] bg-bg-input border-none text-[14px] text-text-primary outline-none appearance-none text-right"
          >
            <option value="">请选择</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 保存按钮 */}
      <button
        onClick={handleSave}
        className="px-5 py-2 rounded-[10px] bg-accent text-white text-[14px] font-medium transition-all duration-[120ms] active:scale-[0.96] hover:opacity-90"
      >
        {saved ? '已保存 ✓' : '保存'}
      </button>
    </div>
  )
}
