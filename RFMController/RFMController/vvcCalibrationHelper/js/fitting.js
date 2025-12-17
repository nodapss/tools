/**
 * VVC Calibration Helper - Curve Fitting Module
 * Polynomial, tanh, and log fitting algorithms
 */

const VVCFitting = (function () {
    /**
     * Polynomial fitting using least squares (Normal Equation)
     * @param {Array<{x: number, y: number}>} points - Data points
     * @param {number} degree - Polynomial degree (1-5)
     * @returns {Object} Fitting result with coefficients and stats
     */
    function polynomialFit(points, degree) {
        const n = points.length;
        if (n < degree + 1) {
            throw new Error(`Need at least ${degree + 1} points for degree ${degree} polynomial`);
        }

        const x = points.map(p => p.x);
        const y = points.map(p => p.y);

        // Normalize x values for numerical stability
        const xMin = Math.min(...x);
        const xMax = Math.max(...x);
        const xRange = xMax - xMin || 1;
        const xNorm = x.map(v => (v - xMin) / xRange);

        // Build Vandermonde matrix
        const X = [];
        for (let i = 0; i < n; i++) {
            const row = [];
            for (let j = 0; j <= degree; j++) {
                row.push(Math.pow(xNorm[i], j));
            }
            X.push(row);
        }

        // Solve normal equation: (X^T * X) * coeffs = X^T * y
        const Xt = transpose(X);
        const XtX = matMul(Xt, X);
        const Xty = matVecMul(Xt, y);

        // Solve using Gaussian elimination
        const coeffsNorm = solveLinear(XtX, Xty);

        // Convert coefficients back to original scale
        const coeffs = denormalizeCoeffs(coeffsNorm, xMin, xRange, degree);

        // Calculate fitted values and stats
        const yFit = x.map(xi => evaluatePolynomial(xi, coeffs));
        const stats = calculateStats(y, yFit);

        return {
            type: `poly${degree}`,
            coefficients: coeffs,
            normalizedCoeffs: coeffsNorm,
            normParams: { xMin, xRange },
            stats,
            equation: formatPolynomialEquation(coeffs),
            evaluate: (xi) => evaluatePolynomial(xi, coeffs)
        };
    }

    /**
     * Denormalize polynomial coefficients
     * Converts coefficients from normalized x (xNorm = (x - xMin) / xRange) to original x scale
     * 
     * For polynomial: C = sum(c_i * xNorm^i) where xNorm = (x - xMin) / xRange
     * We need: C = sum(A_i * x^i)
     * 
     * Let v = xMin / xRange, then xNorm = x/xRange - v
     * Expanding (x/xRange - v)^i and collecting terms gives:
     * A0 = c0 - c1*v + c2*v² - c3*v³ + ...
     * A1 = (c1 - 2*c2*v + 3*c3*v² - ...) / xRange
     * A2 = (c2 - 3*c3*v + ...) / xRange²
     * A3 = c3 / xRange³
     */
    function denormalizeCoeffs(coeffsNorm, xMin, xRange, degree) {
        const coeffs = new Array(degree + 1).fill(0);
        const v = xMin / xRange;
        
        // Build coefficient matrix for transformation
        // Each row i represents how normalized coeff j contributes to denormalized coeff i
        for (let i = 0; i <= degree; i++) {
            for (let j = i; j <= degree; j++) {
                // Contribution of c_j to A_i
                // From expanding (x/xRange - v)^j, the x^i term coefficient is:
                // C(j,i) * (1/xRange)^i * (-v)^(j-i)
                const binom = binomial(j, i);
                const sign = ((j - i) % 2 === 0) ? 1 : -1;
                const factor = binom * sign * Math.pow(v, j - i) / Math.pow(xRange, i);
                coeffs[i] += coeffsNorm[j] * factor;
            }
        }
        
        return coeffs;
    }

    /**
     * Evaluate polynomial at x (using denormalized coefficients - direct calculation)
     */
    function evaluatePolynomial(x, coeffs) {
        let result = 0;
        for (let i = 0; i < coeffs.length; i++) {
            result += coeffs[i] * Math.pow(x, i);
        }
        return result;
    }

    /**
     * tanh fitting: y = a * tanh(b * x + c) + d
     * Uses gradient descent optimization
     */
    function tanhFit(points) {
        const n = points.length;
        if (n < 4) {
            throw new Error('Need at least 4 points for tanh fitting');
        }

        const x = points.map(p => p.x);
        const y = points.map(p => p.y);

        // Normalize inputs
        const xMin = Math.min(...x);
        const xMax = Math.max(...x);
        const xRange = xMax - xMin || 1;
        const xNorm = x.map(v => (v - xMin) / xRange);

        const yMin = Math.min(...y);
        const yMax = Math.max(...y);
        const yMid = (yMin + yMax) / 2;
        const yAmp = (yMax - yMin) / 2 || 1;

        // Initial parameters
        let a = yAmp;
        let b = 2;
        let c = -1;
        let d = yMid;

        // Gradient descent with adaptive learning rate
        const maxIter = 1000;
        let learningRate = 0.1;

        for (let iter = 0; iter < maxIter; iter++) {
            let gradA = 0, gradB = 0, gradC = 0, gradD = 0;

            for (let i = 0; i < n; i++) {
                const xi = xNorm[i];
                const yi = y[i];
                const z = b * xi + c;
                const th = Math.tanh(z);
                const pred = a * th + d;
                const err = pred - yi;
                const sech2 = 1 - th * th;

                gradA += err * th;
                gradB += err * a * sech2 * xi;
                gradC += err * a * sech2;
                gradD += err;
            }

            // Update parameters
            a -= learningRate * gradA / n;
            b -= learningRate * gradB / n;
            c -= learningRate * gradC / n;
            d -= learningRate * gradD / n;

            // Decay learning rate
            if (iter % 100 === 0) {
                learningRate *= 0.9;
            }
        }

        // Adjust parameters for original scale
        const bOrig = b / xRange;
        const cOrig = c - b * xMin / xRange;

        const evaluate = (xi) => a * Math.tanh(bOrig * xi + cOrig) + d;
        const yFit = x.map(evaluate);
        const stats = calculateStats(y, yFit);

        return {
            type: 'tanh',
            coefficients: { a, b: bOrig, c: cOrig, d },
            stats,
            equation: `C = ${a.toFixed(4)} × tanh(${bOrig.toExponential(4)} × step + ${cOrig.toFixed(4)}) + ${d.toFixed(4)}`,
            evaluate
        };
    }

    /**
     * Logarithmic fitting: y = a * ln(x + b) + c
     * Uses iterative optimization
     */
    function logFit(points) {
        const n = points.length;
        if (n < 3) {
            throw new Error('Need at least 3 points for log fitting');
        }

        const x = points.map(p => p.x);
        const y = points.map(p => p.y);

        // Initial guess for b: ensure x + b > 0
        const xMin = Math.min(...x);
        let b = xMin > 0 ? 1 : -xMin + 1;

        // Iterative refinement
        const maxIter = 100;
        let bestMse = Infinity;
        let bestParams = null;

        // Grid search for b
        for (let bTry = b; bTry < b + xMin + 10000; bTry += Math.max(1, (xMin + b) / 20)) {
            // Check if all x + b > 0
            if (x.some(xi => xi + bTry <= 0)) continue;

            // Linear regression on transformed data
            const logX = x.map(xi => Math.log(xi + bTry));
            const meanLogX = logX.reduce((a, b) => a + b, 0) / n;
            const meanY = y.reduce((a, b) => a + b, 0) / n;

            let num = 0, den = 0;
            for (let i = 0; i < n; i++) {
                num += (logX[i] - meanLogX) * (y[i] - meanY);
                den += (logX[i] - meanLogX) ** 2;
            }

            const a = den !== 0 ? num / den : 0;
            const c = meanY - a * meanLogX;

            // Calculate MSE
            let mse = 0;
            for (let i = 0; i < n; i++) {
                const pred = a * logX[i] + c;
                mse += (y[i] - pred) ** 2;
            }
            mse /= n;

            if (mse < bestMse) {
                bestMse = mse;
                bestParams = { a, b: bTry, c };
            }
        }

        if (!bestParams) {
            throw new Error('Could not fit log function to data');
        }

        const { a, b: bFinal, c } = bestParams;
        const evaluate = (xi) => a * Math.log(xi + bFinal) + c;
        const yFit = x.map(evaluate);
        const stats = calculateStats(y, yFit);

        return {
            type: 'log',
            coefficients: { a, b: bFinal, c },
            stats,
            equation: `C = ${a.toFixed(4)} × ln(step + ${bFinal.toFixed(2)}) + ${c.toFixed(4)}`,
            evaluate
        };
    }

    /**
     * Main fit function - dispatches to appropriate fitting method
     */
    function fit(points, type) {
        if (!points || points.length < 2) {
            throw new Error('Need at least 2 data points');
        }

        // Sort points by x
        const sortedPoints = [...points].sort((a, b) => a.x - b.x);

        if (type.startsWith('poly')) {
            const degree = parseInt(type.replace('poly', ''));
            const result = polynomialFit(sortedPoints, degree);
            // Evaluation function uses denormalized coefficients directly
            result.evaluate = (xi) => evaluatePolynomial(xi, result.coefficients);
            return result;
        } else if (type === 'tanh') {
            return tanhFit(sortedPoints);
        } else if (type === 'log') {
            return logFit(sortedPoints);
        } else {
            throw new Error(`Unknown fitting type: ${type}`);
        }
    }

    // Helper functions

    function transpose(matrix) {
        const rows = matrix.length;
        const cols = matrix[0].length;
        const result = [];
        for (let j = 0; j < cols; j++) {
            result[j] = [];
            for (let i = 0; i < rows; i++) {
                result[j][i] = matrix[i][j];
            }
        }
        return result;
    }

    function matMul(A, B) {
        const m = A.length;
        const n = B[0].length;
        const k = B.length;
        const result = [];
        for (let i = 0; i < m; i++) {
            result[i] = [];
            for (let j = 0; j < n; j++) {
                let sum = 0;
                for (let l = 0; l < k; l++) {
                    sum += A[i][l] * B[l][j];
                }
                result[i][j] = sum;
            }
        }
        return result;
    }

    function matVecMul(A, v) {
        const m = A.length;
        const k = v.length;
        const result = [];
        for (let i = 0; i < m; i++) {
            let sum = 0;
            for (let j = 0; j < k; j++) {
                sum += A[i][j] * v[j];
            }
            result[i] = sum;
        }
        return result;
    }

    function solveLinear(A, b) {
        // Gaussian elimination with partial pivoting
        const n = b.length;
        const aug = A.map((row, i) => [...row, b[i]]);

        for (let col = 0; col < n; col++) {
            // Find pivot
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
                    maxRow = row;
                }
            }
            [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

            // Eliminate
            for (let row = col + 1; row < n; row++) {
                const factor = aug[row][col] / aug[col][col];
                for (let j = col; j <= n; j++) {
                    aug[row][j] -= factor * aug[col][j];
                }
            }
        }

        // Back substitution
        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            let sum = aug[i][n];
            for (let j = i + 1; j < n; j++) {
                sum -= aug[i][j] * x[j];
            }
            x[i] = sum / aug[i][i];
        }

        return x;
    }

    function binomial(n, k) {
        if (k < 0 || k > n) return 0;
        if (k === 0 || k === n) return 1;
        let result = 1;
        for (let i = 0; i < k; i++) {
            result = result * (n - i) / (i + 1);
        }
        return result;
    }

    function calculateStats(yActual, yPredicted) {
        const n = yActual.length;
        const yMean = yActual.reduce((a, b) => a + b, 0) / n;

        let ssRes = 0; // Residual sum of squares
        let ssTot = 0; // Total sum of squares
        let sumAbsErr = 0;

        for (let i = 0; i < n; i++) {
            const residual = yActual[i] - yPredicted[i];
            ssRes += residual * residual;
            ssTot += (yActual[i] - yMean) ** 2;
            sumAbsErr += Math.abs(residual);
        }

        const r2 = ssTot !== 0 ? 1 - ssRes / ssTot : 0;
        const rmse = Math.sqrt(ssRes / n);
        const mae = sumAbsErr / n;

        return {
            r2: Math.max(0, Math.min(1, r2)), // Clamp to [0, 1]
            rmse,
            mae,
            n
        };
    }

    function formatPolynomialEquation(coeffs) {
        const terms = [];
        for (let i = coeffs.length - 1; i >= 0; i--) {
            const c = coeffs[i];
            // Skip truly zero coefficients, but keep very small ones (denormalized values can be ~1e-14)
            if (c === 0) continue;

            let term = '';
            if (i === 0) {
                term = c.toFixed(4);
            } else if (i === 1) {
                term = `${c.toExponential(3)} × step`;
            } else {
                term = `${c.toExponential(3)} × step^${i}`;
            }

            if (terms.length > 0 && c > 0) {
                term = '+ ' + term;
            }
            terms.push(term);
        }

        return `C = ${terms.join(' ') || '0'}`;
    }

    // Public API
    return {
        fit,
        polynomialFit,
        tanhFit,
        logFit,
        calculateStats
    };
})();

