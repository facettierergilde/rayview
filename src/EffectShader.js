import * as THREE from 'three';

// allowes to set an exposure level to the Environment map
const EffectShader = {
    uniforms: {
        'sceneDiffuse': { value: null },
        'exposure': { value: 1.0 },
    },

    vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

    fragmentShader: /* glsl */ `
        uniform sampler2D sceneDiffuse;
        uniform float exposure;
        varying vec2 vUv;
		void main() {
            vec4 diffuse = texture2D(sceneDiffuse, vUv);
            
            // Apply exposure
            vec3 color = diffuse.rgb * exposure;
            
            
            gl_FragColor = vec4(color, 1.0);
        }`
};

export { EffectShader };