import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_BASE_URL || '/api';

const ROLE_KR = {
  admin: '시스템관리자', warehouse: '창고작업자',
  dept_admin: '부서관리자',
  applicant: '신청자',
};

const inp = {
  width: '100%', background: '#0d1117', border: '1px solid #30363d',
  borderRadius: 8, color: '#e6edf3', padding: '12px 14px', fontSize: 14,
  outline: 'none', boxSizing: 'border-box',
};

export default function InviteAcceptPage({ token, onDone }) {
  const [step,     setStep]     = useState('loading'); // loading|form|done|error
  const [invInfo,  setInvInfo]  = useState(null);      // { email, role }
  const [name,     setName]     = useState('');
  const [pw,       setPw]       = useState('');
  const [pw2,      setPw2]      = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg,   setErrMsg]   = useState('');

  useEffect(() => {
    axios.get(`${API}/invitations/validate/${token}`)
      .then(r => { setInvInfo(r.data); setStep('form'); })
      .catch(e => {
        if (!e.response) {
          setErrMsg('서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.');
        } else {
          setErrMsg(e.response.data?.error || '유효하지 않은 초대 링크입니다');
        }
        setStep('error');
      });
  }, [token]);

  const handleSubmit = async () => {
    if (!name.trim())       return setErrMsg('이름을 입력하세요');
    if (pw.length < 6)      return setErrMsg('비밀번호는 6자 이상이어야 합니다');
    if (pw !== pw2)         return setErrMsg('비밀번호가 일치하지 않습니다');
    setErrMsg('');
    setSubmitting(true);
    try {
      await axios.post(`${API}/invitations/accept/${token}`, { name: name.trim(), password: pw });
      setStep('done');
    } catch (e) {
      setErrMsg(e.response?.data?.error || '제출 중 오류가 발생했습니다');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      fontFamily: "'Noto Sans KR', system-ui, sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        {/* 로고 */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>DS WMS</div>
          <div style={{ fontSize: 13, color: '#8b949e' }}>Warehouse Management System</div>
        </div>

        {/* loading */}
        {step === 'loading' && (
          <div style={{ textAlign: 'center', color: '#8b949e', padding: 40 }}>
            초대 정보를 확인하는 중...
          </div>
        )}

        {/* error */}
        {step === 'error' && (
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '32px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f85149', marginBottom: 8 }}>
              {errMsg.includes('연결') ? '서버 연결 오류' : '초대 링크 오류'}
            </div>
            <div style={{ fontSize: 13, color: '#8b949e', marginBottom: 24 }}>{errMsg}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              {errMsg.includes('연결') && (
                <button onClick={() => { setStep('loading'); setErrMsg('');
                  axios.get(`${API}/invitations/validate/${token}`)
                    .then(r => { setInvInfo(r.data); setStep('form'); })
                    .catch(e => {
                      setErrMsg(!e.response ? '서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.' : (e.response.data?.error || '유효하지 않은 초대 링크입니다'));
                      setStep('error');
                    });
                }} style={{
                  background: 'linear-gradient(135deg,#0d2a56,#1e4fa0)', border: '1px solid #58a6ff',
                  color: '#fff', padding: '10px 24px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                }}>🔄 다시 시도</button>
              )}
              <button onClick={onDone} style={{
                background: 'none', border: '1px solid #30363d', color: '#8b949e',
                padding: '10px 24px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              }}>로그인 페이지로</button>
            </div>
          </div>
        )}

        {/* form */}
        {step === 'form' && invInfo && (
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '32px 28px' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 18, color: '#e6edf3' }}>가입 정보 입력</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#8b949e' }}>
              아래 정보를 입력하면 관리자 승인 후 로그인이 가능합니다.
            </p>

            {/* 초대 정보 */}
            <div style={{
              background: '#0d1117', border: '1px solid #21262d', borderRadius: 8,
              padding: '12px 16px', marginBottom: 20, fontSize: 13,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#8b949e' }}>이메일</span>
                <span style={{ color: '#e6edf3', fontFamily: 'monospace' }}>{invInfo.email}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b949e' }}>배정 역할</span>
                <span style={{
                  color: '#58a6ff', background: '#0d2044',
                  border: '1px solid #1158b7', borderRadius: 4,
                  padding: '1px 8px', fontSize: 12, fontWeight: 600,
                }}>{ROLE_KR[invInfo.role] || invInfo.role}</span>
              </div>
            </div>

            {/* 이름 */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 6 }}>이름 *</label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={inp} placeholder="홍길동"
              />
            </div>

            {/* 비밀번호 */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 6 }}>비밀번호 * (6자 이상)</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pw} onChange={e => setPw(e.target.value)}
                  style={{ ...inp, paddingRight: 44 }} placeholder="비밀번호 입력"
                />
                <button onClick={() => setShowPw(v => !v)} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 15,
                }}>{showPw ? '🙈' : '👁'}</button>
              </div>
            </div>

            {/* 비밀번호 확인 */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 6 }}>비밀번호 확인 *</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={pw2} onChange={e => setPw2(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={{
                  ...inp,
                  borderColor: pw2 && pw !== pw2 ? '#f85149' : pw2 && pw === pw2 ? '#3fb950' : '#30363d',
                }}
                placeholder="비밀번호 재입력"
              />
              {pw2 && pw !== pw2 && (
                <div style={{ fontSize: 11, color: '#f85149', marginTop: 4 }}>비밀번호가 일치하지 않습니다</div>
              )}
              {pw2 && pw === pw2 && (
                <div style={{ fontSize: 11, color: '#3fb950', marginTop: 4 }}>✓ 비밀번호가 일치합니다</div>
              )}
            </div>

            {/* 에러 메시지 */}
            {errMsg && (
              <div style={{
                background: '#2d0d0b', border: '1px solid #f85149',
                borderRadius: 6, padding: '10px 14px', marginBottom: 16,
                fontSize: 13, color: '#f85149',
              }}>{errMsg}</div>
            )}

            {/* 제출 */}
            <button onClick={handleSubmit} disabled={submitting} style={{
              width: '100%', padding: '13px', fontSize: 15, fontWeight: 700,
              background: submitting ? '#1c2128' : 'linear-gradient(135deg, #0d2a56, #1e4fa0)',
              border: `1px solid ${submitting ? '#30363d' : '#58a6ff'}`,
              color: submitting ? '#8b949e' : '#fff',
              borderRadius: 8, cursor: submitting ? 'default' : 'pointer', transition: 'all 0.15s',
            }}>
              {submitting ? '제출 중...' : '가입 신청'}
            </button>
          </div>
        )}

        {/* done */}
        {step === 'done' && (
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '40px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#3fb950', marginBottom: 8 }}>신청이 완료됐습니다</div>
            <div style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.7, marginBottom: 28 }}>
              관리자가 승인하면 로그인이 가능합니다.<br />
              승인 여부는 관리자에게 문의하세요.
            </div>
            <button onClick={onDone} style={{
              background: 'linear-gradient(135deg, #0d2a56, #1e4fa0)',
              border: '1px solid #58a6ff', color: '#fff',
              padding: '11px 32px', borderRadius: 8, cursor: 'pointer',
              fontSize: 14, fontWeight: 700,
            }}>로그인 페이지로</button>
          </div>
        )}

      </div>
    </div>
  );
}
