import React, { useState } from 'react';
import { authAPI } from '../api/api';
import '../styles/LoginForm.css';

function LoginForm({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    role: 'warehouse',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setError('');
  };

  const validateForm = () => {
    if (!formData.email || !formData.password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return false;
    }

    if (!isLogin) {
      if (!formData.name) {
        setError('이름을 입력해주세요.');
        return false;
      }
      if (formData.password !== formData.confirmPassword) {
        setError('비밀번호가 일치하지 않습니다.');
        return false;
      }
      if (formData.password.length < 6) {
        setError('비밀번호는 최소 6자 이상이어야 합니다.');
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : {
            email: formData.email,
            password: formData.password,
            name: formData.name,
            role: formData.role
          };

      const response = isLogin
        ? await authAPI.login(payload)
        : await authAPI.register(payload);

      if (response.data.token) {
        // 토큰 저장
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user || {
          name: formData.name || formData.email,
          email: formData.email,
          role: formData.role
        }));

        onLoginSuccess(response.data.user || {
          name: formData.name || formData.email,
          email: formData.email,
          role: formData.role
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || '요청 처리 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = (role) => {
    const demoAccounts = {
      admin: { email: 'admin@warehouse.com', password: 'admin123', name: '관리자' },
      dept_admin: { email: 'dept_admin@warehouse.com', password: 'dept123', name: '부서담당자', role: 'dept_admin' },
      applicant: { email: 'applicant@warehouse.com', password: 'app123', name: '신청자' },
      warehouse_pyeongtaek: { email: 'warehouse@warehouse.com', password: 'warehouse123', name: '평택창고 담당자', role: 'warehouse' },
      warehouse_gimje: { email: 'wh_ok_1776728940529@test.com', password: 'warehouse123', name: '김제창고 담당자', role: 'warehouse' }
    };

    const account = demoAccounts[role];
    setFormData({
      ...formData,
      email: account.email,
      password: account.password,
      name: account.name,
      role: account.role || role
    });
    setError('');
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>📦 창고 관리 POS</h1>
          <p>{isLogin ? '로그인' : '회원가입'}</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          {!isLogin && (
            <>
              <div className="form-group">
                <label>이름</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="이름을 입력하세요"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>역할 선택</label>
                <select
                  name="role"
                  value={formData.role}
                  onChange={handleInputChange}
                  className="form-input"
                >
                  <option value="warehouse">창고담당자</option>
                  <option value="applicant">신청자</option>
                </select>
              </div>
            </>
          )}

          <div className="form-group">
            <label>이메일</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="이메일을 입력하세요"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>비밀번호</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              placeholder="비밀번호를 입력하세요"
              className="form-input"
            />
          </div>

          {!isLogin && (
            <div className="form-group">
              <label>비밀번호 확인</label>
              <input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                placeholder="비밀번호를 다시 입력하세요"
                className="form-input"
              />
            </div>
          )}

          <button
            type="submit"
            className="btn-submit"
            disabled={loading}
          >
            {loading ? '처리 중...' : isLogin ? '로그인' : '회원가입'}
          </button>
        </form>

        <div className="toggle-section">
          <p>
            {isLogin ? '계정이 없으신가요?' : '계정이 있으신가요?'}
            <button
              type="button"
              className="toggle-btn"
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
                setFormData({
                  email: '',
                  password: '',
                  name: '',
                  role: 'warehouse',
                  confirmPassword: ''
                });
              }}
            >
              {isLogin ? '회원가입' : '로그인'}
            </button>
          </p>
        </div>

        {isLogin && (
          <div className="demo-section">
            <p className="demo-title">🎯 데모 계정</p>
            <div className="demo-buttons">
              <button
                type="button"
                className="demo-btn"
                onClick={() => handleDemoLogin('admin')}
              >
                관리자 로그인
              </button>
              <button
                type="button"
                className="demo-btn"
                onClick={() => handleDemoLogin('dept_admin')}
              >
                부서담당자 로그인
              </button>
              <button
                type="button"
                className="demo-btn"
                onClick={() => handleDemoLogin('applicant')}
              >
                신청자 로그인
              </button>
              <button
                type="button"
                className="demo-btn"
                onClick={() => handleDemoLogin('warehouse_pyeongtaek')}
              >
                평택창고 담당자 로그인
              </button>
              <button
                type="button"
                className="demo-btn"
                onClick={() => handleDemoLogin('warehouse_gimje')}
              >
                김제창고 담당자 로그인
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LoginForm;
