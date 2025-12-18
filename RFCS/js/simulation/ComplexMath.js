/**
 * ComplexMath.js
 * 복소수 연산 유틸리티 클래스
 * RF 회로 시뮬레이션을 위한 복소수 수학 연산
 */

class Complex {
    constructor(real = 0, imag = 0) {
        this.real = real;
        this.imag = imag;
    }

    /**
     * 복소수 덧셈
     */
    add(other) {
        return new Complex(
            this.real + other.real,
            this.imag + other.imag
        );
    }

    /**
     * 복소수 뺄셈
     */
    sub(other) {
        return new Complex(
            this.real - other.real,
            this.imag - other.imag
        );
    }

    /**
     * 복소수 곱셈
     * (a + bi)(c + di) = (ac - bd) + (ad + bc)i
     */
    mul(other) {
        return new Complex(
            this.real * other.real - this.imag * other.imag,
            this.real * other.imag + this.imag * other.real
        );
    }

    /**
     * 복소수 나눗셈
     * (a + bi)/(c + di) = [(ac + bd) + (bc - ad)i] / (c² + d²)
     */
    div(other) {
        const denominator = other.real * other.real + other.imag * other.imag;
        if (denominator === 0) {
            return new Complex(Infinity, 0);
        }
        return new Complex(
            (this.real * other.real + this.imag * other.imag) / denominator,
            (this.imag * other.real - this.real * other.imag) / denominator
        );
    }

    /**
     * 켤레 복소수 (conjugate)
     */
    conjugate() {
        return new Complex(this.real, -this.imag);
    }

    /**
     * 복소수의 절댓값 (magnitude)
     * |a + bi| = sqrt(a² + b²)
     */
    magnitude() {
        return Math.sqrt(this.real * this.real + this.imag * this.imag);
    }

    /**
     * 복소수의 위상 (phase) - 라디안
     */
    phase() {
        return Math.atan2(this.imag, this.real);
    }

    /**
     * 복소수의 위상 (phase) - 도(degree)
     */
    phaseDeg() {
        return this.phase() * (180 / Math.PI);
    }

    /**
     * 복소수의 역수
     * 1/(a + bi) = (a - bi)/(a² + b²)
     */
    inverse() {
        const magSq = this.real * this.real + this.imag * this.imag;
        if (magSq === 0) {
            return new Complex(Infinity, 0);
        }
        return new Complex(
            this.real / magSq,
            -this.imag / magSq
        );
    }

    /**
     * 스칼라 곱
     */
    scale(scalar) {
        return new Complex(this.real * scalar, this.imag * scalar);
    }

    /**
     * 복소수가 0인지 확인
     */
    isZero(tolerance = 1e-15) {
        return Math.abs(this.real) < tolerance && Math.abs(this.imag) < tolerance;
    }

    /**
     * 복소수가 무한대인지 확인
     */
    isInfinite() {
        return !isFinite(this.real) || !isFinite(this.imag);
    }

    /**
     * 복소수 복사
     */
    clone() {
        return new Complex(this.real, this.imag);
    }

    /**
     * 문자열 표현
     */
    toString(precision = 4) {
        const r = this.real.toFixed(precision);
        const i = Math.abs(this.imag).toFixed(precision);
        if (this.imag >= 0) {
            return `${r} + ${i}j`;
        } else {
            return `${r} - ${i}j`;
        }
    }

    /**
     * 정적 메서드: 극좌표에서 복소수 생성
     * magnitude * e^(j*phase)
     */
    static fromPolar(magnitude, phase) {
        return new Complex(
            magnitude * Math.cos(phase),
            magnitude * Math.sin(phase)
        );
    }

    /**
     * 정적 메서드: {real, imag} 객체에서 Complex 생성
     */
    static fromObject(obj) {
        return new Complex(obj.real || 0, obj.imag || 0);
    }

    /**
     * 정적 메서드: 실수에서 Complex 생성
     */
    static fromReal(real) {
        return new Complex(real, 0);
    }

    /**
     * 정적 메서드: 순허수에서 Complex 생성
     */
    static fromImag(imag) {
        return new Complex(0, imag);
    }
}

/**
 * ComplexMatrix 클래스
 * 복소수 행렬 연산 (Modified Nodal Analysis용)
 */
class ComplexMatrix {
    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.data = [];
        
        // 0으로 초기화
        for (let i = 0; i < rows; i++) {
            this.data[i] = [];
            for (let j = 0; j < cols; j++) {
                this.data[i][j] = new Complex(0, 0);
            }
        }
    }

    /**
     * 행렬 요소 가져오기
     */
    get(row, col) {
        return this.data[row][col];
    }

    /**
     * 행렬 요소 설정
     */
    set(row, col, value) {
        if (value instanceof Complex) {
            this.data[row][col] = value;
        } else {
            this.data[row][col] = new Complex(value, 0);
        }
    }

    /**
     * 행렬 요소에 값 더하기
     */
    addAt(row, col, value) {
        if (value instanceof Complex) {
            this.data[row][col] = this.data[row][col].add(value);
        } else {
            this.data[row][col] = this.data[row][col].add(new Complex(value, 0));
        }
    }

    /**
     * 행렬 복사
     */
    clone() {
        const result = new ComplexMatrix(this.rows, this.cols);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                result.data[i][j] = this.data[i][j].clone();
            }
        }
        return result;
    }

    /**
     * Gauss-Jordan 소거법을 이용한 연립방정식 풀이
     * Ax = b 형태에서 x를 구함
     * augmented: [A | b] 형태의 확대 행렬
     * 반환: 해 벡터 x (Complex 배열)
     */
    static solve(A, b) {
        const n = A.rows;
        
        // 확대 행렬 생성 [A | b]
        const aug = new ComplexMatrix(n, n + 1);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                aug.set(i, j, A.get(i, j).clone());
            }
            aug.set(i, n, b[i].clone());
        }

        // Gauss-Jordan 소거법
        for (let col = 0; col < n; col++) {
            // 피벗 찾기 (부분 피봇팅)
            let maxRow = col;
            let maxVal = aug.get(col, col).magnitude();
            
            for (let row = col + 1; row < n; row++) {
                const val = aug.get(row, col).magnitude();
                if (val > maxVal) {
                    maxVal = val;
                    maxRow = row;
                }
            }

            // 행 교환
            if (maxRow !== col) {
                for (let j = 0; j <= n; j++) {
                    const temp = aug.get(col, j);
                    aug.set(col, j, aug.get(maxRow, j));
                    aug.set(maxRow, j, temp);
                }
            }

            // 피벗이 0이면 특이 행렬
            const pivot = aug.get(col, col);
            if (pivot.magnitude() < 1e-15) {
                console.warn('Singular matrix encountered at column', col);
                continue;
            }

            // 피벗 행을 피벗으로 나눔
            const pivotInv = pivot.inverse();
            for (let j = col; j <= n; j++) {
                aug.set(col, j, aug.get(col, j).mul(pivotInv));
            }

            // 다른 행들 소거
            for (let row = 0; row < n; row++) {
                if (row !== col) {
                    const factor = aug.get(row, col);
                    for (let j = col; j <= n; j++) {
                        aug.set(row, j, aug.get(row, j).sub(factor.mul(aug.get(col, j))));
                    }
                }
            }
        }

        // 해 추출
        const x = [];
        for (let i = 0; i < n; i++) {
            x.push(aug.get(i, n));
        }

        return x;
    }

    /**
     * 행렬 문자열 표현 (디버깅용)
     */
    toString() {
        let str = '';
        for (let i = 0; i < this.rows; i++) {
            str += '[ ';
            for (let j = 0; j < this.cols; j++) {
                str += this.data[i][j].toString(2) + ' ';
            }
            str += ']\n';
        }
        return str;
    }

    /**
     * 단위 행렬 생성 (정적 메서드)
     * @param {number} size - 행렬 크기
     * @returns {ComplexMatrix} 단위 행렬
     */
    static identity(size) {
        const I = new ComplexMatrix(size, size);
        for (let i = 0; i < size; i++) {
            I.set(i, i, new Complex(1, 0));
        }
        return I;
    }

    /**
     * 스칼라 곱 (행렬의 모든 요소에 스칼라 곱)
     * @param {Complex|number} scalar - 스칼라 값
     * @returns {ComplexMatrix} 결과 행렬
     */
    scale(scalar) {
        const result = new ComplexMatrix(this.rows, this.cols);
        const s = scalar instanceof Complex ? scalar : new Complex(scalar, 0);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                result.set(i, j, this.get(i, j).mul(s));
            }
        }
        return result;
    }

    /**
     * 행렬 덧셈
     * @param {ComplexMatrix} other - 더할 행렬
     * @returns {ComplexMatrix} 결과 행렬
     */
    add(other) {
        if (this.rows !== other.rows || this.cols !== other.cols) {
            throw new Error('Matrix dimensions must match for addition');
        }
        const result = new ComplexMatrix(this.rows, this.cols);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                result.set(i, j, this.get(i, j).add(other.get(i, j)));
            }
        }
        return result;
    }

    /**
     * 행렬 뺄셈
     * @param {ComplexMatrix} other - 뺄 행렬
     * @returns {ComplexMatrix} 결과 행렬
     */
    subtract(other) {
        if (this.rows !== other.rows || this.cols !== other.cols) {
            throw new Error('Matrix dimensions must match for subtraction');
        }
        const result = new ComplexMatrix(this.rows, this.cols);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                result.set(i, j, this.get(i, j).sub(other.get(i, j)));
            }
        }
        return result;
    }

    /**
     * 행렬 곱셈
     * @param {ComplexMatrix} other - 곱할 행렬
     * @returns {ComplexMatrix} 결과 행렬
     */
    multiply(other) {
        if (this.cols !== other.rows) {
            throw new Error('Matrix dimensions incompatible for multiplication');
        }
        const result = new ComplexMatrix(this.rows, other.cols);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < other.cols; j++) {
                let sum = new Complex(0, 0);
                for (let k = 0; k < this.cols; k++) {
                    sum = sum.add(this.get(i, k).mul(other.get(k, j)));
                }
                result.set(i, j, sum);
            }
        }
        return result;
    }

    /**
     * 역행렬 계산 (Gauss-Jordan 소거법)
     * @returns {ComplexMatrix|null} 역행렬 또는 특이 행렬인 경우 null
     */
    inverse() {
        if (this.rows !== this.cols) {
            throw new Error('Only square matrices can be inverted');
        }
        
        const n = this.rows;
        
        // 확대 행렬 [A | I] 생성
        const aug = new ComplexMatrix(n, 2 * n);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                aug.set(i, j, this.get(i, j).clone());
            }
            for (let j = 0; j < n; j++) {
                aug.set(i, j + n, i === j ? new Complex(1, 0) : new Complex(0, 0));
            }
        }

        // Gauss-Jordan 소거법
        for (let col = 0; col < n; col++) {
            // 피벗 찾기 (부분 피봇팅)
            let maxRow = col;
            let maxVal = aug.get(col, col).magnitude();
            
            for (let row = col + 1; row < n; row++) {
                const val = aug.get(row, col).magnitude();
                if (val > maxVal) {
                    maxVal = val;
                    maxRow = row;
                }
            }

            // 행 교환
            if (maxRow !== col) {
                for (let j = 0; j < 2 * n; j++) {
                    const temp = aug.get(col, j);
                    aug.set(col, j, aug.get(maxRow, j));
                    aug.set(maxRow, j, temp);
                }
            }

            // 피벗이 0이면 특이 행렬
            const pivot = aug.get(col, col);
            if (pivot.magnitude() < 1e-15) {
                console.warn('Singular matrix, cannot invert');
                return null;
            }

            // 피벗 행을 피벗으로 나눔
            const pivotInv = pivot.inverse();
            for (let j = 0; j < 2 * n; j++) {
                aug.set(col, j, aug.get(col, j).mul(pivotInv));
            }

            // 다른 행들 소거
            for (let row = 0; row < n; row++) {
                if (row !== col) {
                    const factor = aug.get(row, col);
                    for (let j = 0; j < 2 * n; j++) {
                        aug.set(row, j, aug.get(row, j).sub(factor.mul(aug.get(col, j))));
                    }
                }
            }
        }

        // 역행렬 추출 (오른쪽 절반)
        const result = new ComplexMatrix(n, n);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                result.set(i, j, aug.get(i, j + n));
            }
        }
        
        return result;
    }
}

/**
 * S-파라미터 관련 유틸리티 함수들
 */
const SParamUtils = {
    /**
     * 임피던스에서 반사계수(Gamma) 계산
     * Gamma = (Z - Z0) / (Z + Z0)
     */
    impedanceToGamma(Z, Z0 = 50) {
        const z0 = new Complex(Z0, 0);
        return Z.sub(z0).div(Z.add(z0));
    },

    /**
     * 반사계수에서 임피던스 계산
     * Z = Z0 * (1 + Gamma) / (1 - Gamma)
     */
    gammaToImpedance(gamma, Z0 = 50) {
        const one = new Complex(1, 0);
        const z0 = new Complex(Z0, 0);
        return z0.mul(one.add(gamma)).div(one.sub(gamma));
    },

    /**
     * S11 magnitude를 dB로 변환
     * dB = 20 * log10(|S11|)
     */
    magnitudeToDb(magnitude) {
        if (magnitude <= 0) return -100; // 최소값 제한
        return 20 * Math.log10(magnitude);
    },

    /**
     * dB를 linear magnitude로 변환
     */
    dbToMagnitude(db) {
        return Math.pow(10, db / 20);
    },

    /**
     * VSWR 계산
     * VSWR = (1 + |Gamma|) / (1 - |Gamma|)
     */
    gammaToVSWR(gamma) {
        const mag = gamma.magnitude();
        if (mag >= 1) return Infinity;
        return (1 + mag) / (1 - mag);
    },

    /**
     * Return Loss 계산 (dB)
     * RL = -20 * log10(|Gamma|)
     */
    returnLoss(gamma) {
        const mag = gamma.magnitude();
        if (mag <= 0) return 100; // 최대값 제한
        return -20 * Math.log10(mag);
    }
};

// 전역 노출
window.Complex = Complex;
window.ComplexMatrix = ComplexMatrix;
window.SParamUtils = SParamUtils;


