import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { GUI } from 'lil-gui';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectShader } from "./EffectShader.js";
import { AssetManager } from './AssetManager.js';
import { Stats } from "./stats.js";
import { getMeshRefractionMaterial } from "./diamondMaterial.js";
import {
    MeshBVH,
    MeshBVHHelper,
    SAH
} from 'three-mesh-bvh';



async function main() {
    // Setup basic renderer, controls, and profiler
    const clientWidth = window.innerWidth * 0.99;
    const clientHeight = window.innerHeight * 0.98;

    let loadingModel = false;
    let currentDiamond = null;
    let lastGeometry = null;

    const response = await fetch("./environments/environments.json");
    const environments = await response.json();

    const scene = new THREE.Scene();
    
    // Helpers
    let o = new THREE.Vector3(0,0,0);
    let x = new THREE.Vector3(1,0,0);
    let y = new THREE.Vector3(0,1,0);
    let z = new THREE.Vector3(0,0,1);
    //scene.add( new THREE.GridHelper( 2, 20 ) );
    
    const arrowHelperX =new THREE.ArrowHelper(x,o,2,'crimson');
    const arrowHelperY =new THREE.ArrowHelper(y,o,2,'green');
    const arrowHelperZ =new THREE.ArrowHelper(z,o,2,'royalblue');
    scene.add( arrowHelperX);
    scene.add( arrowHelperY );
    scene.add( arrowHelperZ );

    const camera = new THREE.PerspectiveCamera(15, clientWidth / clientHeight, 0.1, 1000);
    camera.position.set(-50, 0, 0);

    // The environment is drawn with its own wider-FOV camera so it looks further away
    // (a "bigger room") without changing the narrow FOV used for the diamond.
    const backgroundScene = new THREE.Scene();
    const backgroundCamera = new THREE.PerspectiveCamera(50, clientWidth / clientHeight, 0.1, 1000);
    let visualizer;
    let collider;

    let boundingBox = new THREE.Box3();
    let boxHelper;

    const renderer = new THREE.WebGLRenderer();

    // Render at device resolution, otherwise HiDPI/4K screens get an upscaled (blurry) image
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(clientWidth, clientHeight);
    const getBufferSize = () => renderer.getDrawingBufferSize(new THREE.Vector2());
    document.body.appendChild(renderer.domElement);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.toneMapping = THREE.LinearToneMapping;
    
    const hdriLoader = new RGBELoader();
    const loadHdrAsync = (url) => new Promise(resolve => hdriLoader.load( url, resolve));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.minDistance = 0.2;
    const stats = new Stats();
    stats.showPanel(0);
    document.body.appendChild(stats.dom);

    // Create file upload button
    const { fileInput, loadingIndicator, uploadButton } = createUiElements();


    const envId = 4;
    let environment = undefined;
    await loadEnvironment(environments.aerodynamics_workshop);

    // Lighting
    const ambientLight = new THREE.AmbientLight(new THREE.Color(1.0, 1.0, 1.0), 0.25);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.35);
    directionalLight.position.set(150, 200, 50);
    
    // Shadows
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.left = -75;
    directionalLight.shadow.camera.right = 75;
    directionalLight.shadow.camera.top = 75;
    directionalLight.shadow.camera.bottom = -75;
    directionalLight.shadow.camera.near = 0.01;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.bias = -0.001;
    directionalLight.shadow.blurSamples = 8;
    directionalLight.shadow.radius = 4;
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.15);
    directionalLight2.color.setRGB(1.0, 1.0, 1.0);
    directionalLight2.position.set(-50, 200, -150);
    scene.add(directionalLight2);

    // Objects
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(5, 5).applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: 0xffffff }));
    ground.castShadow = true;
    ground.receiveShadow = true;
    ground.position.set(0,0,0);
    ground.visible = false;
    scene.add(ground);

    // Create a container for the diamond mesh so we can replace it
    const diamondContainer = new THREE.Object3D();
    scene.add(diamondContainer);

    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const cubeCamera = new THREE.CubeCamera(1, 100000, cubeRenderTarget);
    scene.add(cubeCamera);
    cubeCamera.position.set(0, 5, 0);
    cubeCamera.update(renderer, scene);
    //scene.background = cubeRenderTarget.texture;

    // Create GUI panels for better organization
    const gui = new GUI();
    const opticsFolder = gui.addFolder('Optics');
    const stoneFolder = gui.addFolder('Stone Appearance');
    const positionFolder = gui.addFolder('Position & Animation');

        // Define the effect controller with all parameters
    const effectController = {
        bounces: 3.0,
        ior: 1.54,
        correctMips: true,
        fastChroma: true,
        chromaticAberration: true,
        aberrationStrength: 0.01,
        stoneColor: '#ffffff', // Using hex color string for the color picker
        fresnel: 0.2,
        yPosition: 0.0,
        xRotation: 0,
        yRotation: 0,
        zRotation: 0,
        xSize: 0,
        ySize: 0,
        zSize: 0,
        animRotation: 0,
        animate: false,
        debug: false,
        rotationSpeed: 0.01,
        setTopCamera: function() { camera.position.set(0, 20, 0); camera.updateProjectionMatrix();},
        setSideCamera: function() { camera.position.set(0, 10, -30); },
        exposure: 1.0,
        backgroundFov: 50,
        hideGround: true,
        hideBox: true,
        environmentId: environments.aerodynamics_workshop,
        setInitView: function() { 
            camera.position.set(0, 0, -10); 
            if (currentDiamond) {
                currentDiamond.rotation.x = 0;
                currentDiamond.rotation.y = 0;
                currentDiamond.rotation.z = 0;
            }
        },
        setSideView: function()  { 
            camera.position.set(-10, 0, 0); 
            if (currentDiamond) {
                currentDiamond.rotation.x = 0;
                currentDiamond.rotation.y = Math.PI/2;
                currentDiamond.rotation.z = 0;
            }
        },
        px: function()  {camera.position.set(-20, 0, 0);},
        nx: function()  {camera.position.set(20, 0, 0);},
        py: function()  {camera.position.set(0, -20, 0);},
        ny: function()  {camera.position.set(0, 20, 0);},
        pz: function()  {camera.position.set(0, 0, -20);},
        nz: function()  {camera.position.set(0, 0, 20);},
    };
    const sphere1 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12,12), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: "hotpink" }));
    const sphere2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12,12), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: "yellow" }));
    const sphere3 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12,12), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: "red" }));
    const sphere4 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12,12), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: "green" }));
    const sphere5 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12,12), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: "orange" }));
    const sphere6 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12,12), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: "blue" }));
    sphere1.position.set(2,0,0);
    sphere2.position.set(-2,0,0);
    sphere3.position.set(0,0,2);
    sphere4.position.set(0,0,-2);
    sphere5.position.set(0,2,0);
    sphere6.position.set(0,-2,0);
    scene.add(sphere1);
    scene.add(sphere2);
    scene.add(sphere3);
    scene.add(sphere4);
    scene.add(sphere5);
    scene.add(sphere6);

    sphere1.visible = false;
    sphere2.visible = false;
    sphere3.visible = false;
    sphere4.visible = false;
    sphere5.visible = false;
    sphere6.visible = false;
    arrowHelperX.visible = false;
    arrowHelperY.visible = false;
    arrowHelperZ.visible = false;


    const makeDiamond = (geo, {
        color = new THREE.Color(1, 1, 1),
        ior = 2.4,
        fastChroma = false,
        aberrationStrength = 0.0,
        chromaticAberration = true,
    } = {}) => {

        console.log("makeDiamond");
        geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 1));
        const mergedGeometry = geo;
        mergedGeometry.boundsTree = new MeshBVH(mergedGeometry.index ? mergedGeometry.toNonIndexed() : mergedGeometry, { lazyGeneration: false, strategy: SAH });

        if(collider){
            scene.remove(collider);
        }
        collider = new THREE.Mesh(mergedGeometry);
        collider.material.wireframe = true;
        collider.material.opacity = 0.5;
        collider.material.transparent = true;
        collider.visible = false;
        collider.boundsTree = mergedGeometry.boundsTree;
        scene.add(collider);

        if(visualizer){
            scene.remove(visualizer);
        }
        visualizer = new MeshBVHHelper(collider, 20);
        visualizer.visible = false;
        visualizer.update();
        scene.add(visualizer);

        const bufferSize = getBufferSize();
        const meshMaterial = getMeshRefractionMaterial(environment, color, ior, camera, fastChroma, chromaticAberration, aberrationStrength, bufferSize.x, bufferSize.y);
        const diamond = new THREE.Mesh(geo, meshMaterial);
        
        diamond.material.uniforms.bvh.value.updateFrom(collider.boundsTree);
        diamond.castShadow = true;
        diamond.receiveShadow = true;
        
        diamond.rotation.x = effectController.xRotation / 360 * (Math.PI * 2);
        diamond.rotation.y = effectController.yRotation / 360 * (Math.PI * 2);
        diamond.rotation.z = effectController.zRotation / 360 * (Math.PI * 2);
        diamond.position.y = effectController.yPosition;
        return diamond;
    }

    // File upload handler
    fileInput.addEventListener('change', async (event) => {
        if (event.target.files.length === 0 || loadingModel) return;

        // Show loading indicator
        loadingIndicator.style.display = 'block';
        loadingModel = true;

        try {
            const file = event.target.files[0];
            const reader = new FileReader();

            reader.onload = async function(e) {
                const arrayBuffer = e.target.result;
                const fileExtension = file.name.split('.').pop().toLowerCase();

                if (fileExtension === 'stl') {
                    // Handle STL file
                    const stlLoader = new STLLoader();
                    try {
                        const geometry = stlLoader.parse(arrayBuffer);
                        loadGeometry(geometry, file.name);
                    } catch (error) {
                        console.error('Error parsing STL:', error);
                        alert('Error parsing STL file: ' + error.message);
                        loadingIndicator.style.display = 'none';
                        loadingModel = false;
                    }
                } else if (fileExtension === 'obj') {
                    // Handle OBJ file
                    const objLoader = new OBJLoader();
                    try {
                        var enc = new TextDecoder("utf-8");
                        const geometryGroup = objLoader.parse(enc.decode(arrayBuffer));
                        let geometry = null;
                        // select first child in group that is a mesh
                        for (let child of geometryGroup.children) {
                            if (child.isMesh && !geometry) {
                                geometry = child.geometry.clone();
                                break;
                            };
                        }

                        if (geometry) {
                            loadGeometry(geometry, file.name);
                        } else {
                            alert('No mesh found in the uploaded file.');
                            loadingIndicator.style.display = 'none';
                            loadingModel = false;
                        }
                    } catch (error) {
                        console.error('Error parsing OBJ:', error);
                        alert('Error parsing OBJ file: ' + error.message);
                        loadingIndicator.style.display = 'none';
                        loadingModel = false;
                    }
                } else {
                    // Handle GLTF/GLB file
                    const gltfLoader = new GLTFLoader();
                    gltfLoader.parse(arrayBuffer, '', function(gltf) {
                        // Find the first mesh in the loaded GLTF
                        let geometry = null;
                        gltf.scene.traverse(function(child) {
                            if (child.isMesh && !geometry) {
                                geometry = child.geometry.clone();
                            }
                        });

                        if (geometry) {
                            loadGeometry(geometry, file.name);
                        } else {
                            alert('No mesh found in the uploaded file.');
                            loadingIndicator.style.display = 'none';
                            loadingModel = false;
                        }
                    }, function(error) {
                        console.error('Error loading model:', error);
                        alert('Error loading model: ' + error.message);
                        loadingIndicator.style.display = 'none';
                        loadingModel = false;
                    });
                }
            };

            reader.onerror = function() {
                console.error('Error reading file');
                alert('Error reading file');
                loadingIndicator.style.display = 'none';
                loadingModel = false;
            };

            // Read as array buffer for STL, OBJ and GLTF/GLB
            reader.readAsArrayBuffer(file);
        } catch (error) {
            console.error('Error:', error);
            alert('Error: ' + error.message);
            loadingIndicator.style.display = 'none';
            loadingModel = false;
        }
    });

    // Common function to process geometry after loading
    function loadGeometry(geometry, fileName) {
        // dispose last geometry if it is not a reload of the same
        if(lastGeometry && lastGeometry.uuid != geometry.uuid)
        {
            lastGeometry.dispose();
        }
        lastGeometry = geometry;

        // Create and compute normals if they don't exist
        if (!lastGeometry.hasAttribute('normal')) {
            lastGeometry.computeVertexNormals();
        }

        // Remove existing diamond if there is one
        if (currentDiamond) {
            diamondContainer.remove(currentDiamond);
        }

        // Create and add the new diamond with the current color setting
        const stoneColor = new THREE.Color(effectController.stoneColor);
        currentDiamond = makeDiamond(lastGeometry, { color: stoneColor });


        scene.remove( boxHelper );
        boundingBox.setFromObject(currentDiamond, true);
        boxHelper = new THREE.Box3Helper( boundingBox, 0xffff00 );
        boxHelper.visible = !effectController?.hideBox;
        scene.add( boxHelper );
        diamondContainer.add(currentDiamond);

        // Update the file name display
        if(fileName)
        {
            uploadButton.textContent = 'Model: ' + fileName;
        }

        setStoneToGround();

        // Hide loading indicator
        loadingIndicator.style.display = 'none';
        loadingModel = false;
    }

    // Build postprocessing stack
    // Render Targets
    const initialBufferSize = getBufferSize();
    const defaultTexture = new THREE.WebGLRenderTarget(initialBufferSize.x, initialBufferSize.y, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.NearestFilter
    });
    defaultTexture.depthTexture = new THREE.DepthTexture(initialBufferSize.x, initialBufferSize.y, THREE.FloatType);
    
    // Post Effects
    const composer = new EffectComposer(renderer);
    const smaaPass = new SMAAPass(clientWidth, clientHeight);
    const effectPass = new ShaderPass(EffectShader);
    composer.addPass(effectPass);
    composer.addPass(new ShaderPass(GammaCorrectionShader));
    composer.addPass(smaaPass);



    // Load default diamond model
    loadingIndicator.style.display = 'block';
    try {
        let defaultStone = "default.glb";
        let diamondGeo = (await AssetManager.loadGLTFAsync(defaultStone)).scene.children[0].geometry;
        loadGeometry(diamondGeo, defaultStone);
    } catch (error) {
        console.error('Error loading default model:', error);
    }
    loadingIndicator.style.display = 'none';



    gui.add(effectController, "debug").name("Debug").onChange(function(){
        sphere1.visible = effectController.debug;
        sphere2.visible = effectController.debug;
        sphere3.visible = effectController.debug;
        sphere4.visible = effectController.debug;
        sphere5.visible = effectController.debug;
        sphere6.visible = effectController.debug;
        arrowHelperX.visible = effectController.debug;
        arrowHelperY.visible = effectController.debug;
        arrowHelperZ.visible = effectController.debug;
    });
    


    opticsFolder.add(effectController, "bounces", 1.0, 10.0, 1.0).name("Bounces");
    opticsFolder.add(effectController, "ior", 1.0, 5.0, 0.01).name("IOR");
    opticsFolder.add(effectController, "correctMips").name("Correct Mips");
    opticsFolder.add(effectController, "fastChroma").name("Fast Chroma");
    opticsFolder.add(effectController, "chromaticAberration").name("Chromatic Aberration");
    opticsFolder.add(effectController, "aberrationStrength", 0.00, 1.0, 0.0001).name("Aberration Strength");
    opticsFolder.add(effectController, "fresnel", 0, 1, 0.01).name("Fresnel");
    opticsFolder.add(effectController, "environmentId", environments).name("Environment").onChange(async function (env) {await loadEnvironment(env);});
    opticsFolder.add(effectController, "exposure", 0.0, 2.0, 0.01).name("Exposure");
    opticsFolder.add(effectController, "backgroundFov", 15, 120, 1).name("Room Size (BG FOV)").onChange(function(fov) {
        backgroundCamera.fov = fov;
        backgroundCamera.updateProjectionMatrix();
    });
    opticsFolder.add(effectController, "setTopCamera").name("Top camera");
    opticsFolder.add(effectController, "setSideCamera").name("Side camera");
    opticsFolder.add(effectController, "setInitView").name("Set init View (Z)");
    opticsFolder.add(effectController, "setSideView").name("Set side View (X)");
    opticsFolder.add(effectController, "px").name("x");
    opticsFolder.add(effectController, "nx").name("-x");
    opticsFolder.add(effectController, "py").name("y");
    opticsFolder.add(effectController, "ny").name("-y");
    opticsFolder.add(effectController, "pz").name("z");
    opticsFolder.add(effectController, "nz").name("-z");
    opticsFolder.add(effectController, "xSize").name("Size: x").listen(true).decimals(3).onChange((size) => {
        if (isNaN(size) || size <= 0) {
            return;
        }
	    console.log( 'The size is now ' + size );
        let factor = size / (boundingBox.max.x-boundingBox.min.x);
        if(factor > 0)
        {
            currentDiamond.scale.setScalar( factor * currentDiamond.scale.x );
        }
    });
    opticsFolder.add(effectController, "ySize").name("Size: y").listen(true).decimals(3).onChange((size) => {
        if (isNaN(size) || size <= 0) {
            return;
        }
	    console.log( 'The size is now ' + size );
        let factor = size / (boundingBox.max.y-boundingBox.min.y);
        if(factor > 0)
        {
            currentDiamond.scale.setScalar( factor * currentDiamond.scale.y );
        }
    });
    opticsFolder.add(effectController, "zSize").name("Size: z").listen(true).decimals(3).onChange((size) => {
        if (isNaN(size) || size <= 0) {
            return;
        }
	    console.log( 'The size is now ' + size );
        let factor = size / (boundingBox.max.z-boundingBox.min.z);
        if(factor > 0)
        {
            currentDiamond.scale.setScalar( factor * currentDiamond.scale.z );
        }
    });
    opticsFolder.open();


    // Add color picker
    const updateColor = function() {
        if (currentDiamond) {
            const newColor = new THREE.Color(effectController.stoneColor);
            currentDiamond.material.uniforms.color.value = newColor;
        }
    };

    stoneFolder.addColor(effectController, "stoneColor").name("Stone Color").onChange(updateColor);

    // Add a color reset button
    stoneFolder.add({
        resetColor: function() {
            effectController.stoneColor = '#ffffff';
            updateColor();
            // Update all controllers in the GUI
            for (const controller of stoneFolder.controllers) {
                controller.updateDisplay();
            }
        }
    }, 'resetColor').name('Reset to White');
    stoneFolder.open();

    // Add y-position control
    positionFolder.add(effectController, "yPosition", -10.0, 10.0, 0.1).name("Y Position").onChange(function() {
        if (currentDiamond) {
            // Update the diamond's position
            currentDiamond.position.y = effectController.yPosition;
        }
    });

    function setStoneToGround() {
        currentDiamond.geometry.computeBoundingBox();
        const box = new THREE.Box3();
        box.setFromObject(currentDiamond, true);
        effectController.yPosition = currentDiamond.position.y-box.min.y;
        // Update all controllers in the GUI
        for (const controller of positionFolder.controllers) {
            controller.updateDisplay();
        }
    }

    positionFolder.add({
        setToGround: setStoneToGround
    }, 'setToGround').name('Set Stone to ground');

    // Add x-rotation control (manual rotation)
    positionFolder.add(effectController, "xRotation", 0, 360, 1.0).name("X Rotation").onChange(function() {
        if (currentDiamond) {
            currentDiamond.rotation.x = effectController.xRotation / 360 * (Math.PI * 2);
        }
    });

    // Add y-rotation control (manual rotation)
    positionFolder.add(effectController, "yRotation", 0, 360, 1.0).name("Y Rotation").onChange(function() {
        if (currentDiamond) {
            currentDiamond.rotation.y = effectController.yRotation / 360 * (Math.PI * 2);
        }
    });

    // Add z-rotation control (manual rotation)
    positionFolder.add(effectController, "zRotation", 0, 360, 1.0).name("Z Rotation").onChange(function() {
        if (currentDiamond) {
            currentDiamond.rotation.z = effectController.zRotation / 360 * (Math.PI * 2);
        }
    });


    // Add anim-rotation control (manual rotation)
    positionFolder.add(effectController, "animRotation", 0, 360, 5.0).name("Anim Rotation").onChange(function() {
        if (currentDiamond) {
            diamondContainer.rotation.y = effectController.animRotation / 360 * (Math.PI * 2);
        }
    });

    // Animation controls
    positionFolder.add(effectController, "animate").name("Animate Rotation");

    positionFolder.add(effectController, "rotationSpeed", 0, 0.1, 0.001).name("Rotation Speed");

    // Ground controls
    positionFolder.add(effectController, "hideGround").name("Hide Ground").onChange(function(){
        ground.visible = !effectController.hideGround;
    });
    positionFolder.add(effectController, "hideBox").name("Hide Box").onChange(function(){
        boxHelper.visible = !effectController.hideBox;
    });

    positionFolder.open();

    // Handle window resize
    window.addEventListener('resize', function() {
        console.log("Window resized");
        const newWidth = window.innerWidth * 0.99;
        const newHeight = window.innerHeight * 0.98;

        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        backgroundCamera.aspect = camera.aspect;
        backgroundCamera.updateProjectionMatrix();

        // devicePixelRatio changes when the window moves to a monitor with different scaling
        renderer.setPixelRatio(window.devicePixelRatio);
        composer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(newWidth, newHeight);
        composer.setSize(newWidth, newHeight);

        const bufferSize = getBufferSize();
        defaultTexture.setSize(bufferSize.x, bufferSize.y);

        // Update resolution uniform if it exists in any materials
        if (currentDiamond) {
            currentDiamond.material.uniforms.resolution.value.copy(bufferSize);
        }
    });

    

    async function loadEnvironment(env) {
        // Show loading indicator
        loadingIndicator.style.display = 'block';
        loadingModel = true;

        // check if we changed from hdr to skybox or vice versa
        const envTypeSwitched = environment && (environment.hasOwnProperty('isCubeTexture') && !env.isSkybox || !environment.hasOwnProperty('isCubeTexture') && env.isSkybox);

        if( environment != undefined){
            environment.dispose();
        }

        if(env.isSkybox)
        {
            environment = await new THREE.CubeTextureLoader().loadAsync([
                env.id + "/px.png", //right
                env.id + "/nx.png", //left
                env.id + "/py.png", //top
                env.id + "/ny.png", //bottom
                env.id + "/pz.png", //front
                env.id + "/nz.png" //back
            ]);
            environment.colorSpace = THREE.SRGBColorSpace;
        } else {
            const texture = await loadHdrAsync(env.url);
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.LinearSRGBColorSpace; // HDR data is linear
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
            environment = texture;
            texture.dispose();
        }
        backgroundScene.background = environment;
        //scene.background = 0xffffff;
        //scene.environment = environment;
        if(currentDiamond && environment) {
            currentDiamond.material.uniforms.envMap.value = environment;
            currentDiamond.material.needsUpdate = true;
        }

        if(currentDiamond && envTypeSwitched)
        {
            loadGeometry(lastGeometry);
        }

        loadingIndicator.style.display = 'none';
        loadingModel = false;
    }

    function animate() {
        if (currentDiamond) {
            // Update material parameters
            currentDiamond.material.uniforms.bounces.value = effectController.bounces;
            currentDiamond.material.uniforms.ior.value = effectController.ior;
            currentDiamond.material.uniforms.correctMips.value = effectController.correctMips;
            currentDiamond.material.uniforms.fastChroma.value = effectController.fastChroma;
            currentDiamond.material.uniforms.chromaticAberration.value = effectController.chromaticAberration;
            currentDiamond.material.uniforms.aberrationStrength.value = effectController.aberrationStrength;
            currentDiamond.material.uniforms.fresnel.value = effectController.fresnel;

            // Update Y position directly from the controller
            currentDiamond.position.y = effectController.yPosition;

            // Handle rotation based on animation toggle
            if (effectController.animate) {
                diamondContainer.rotation.y += effectController.rotationSpeed;
                // Update the rotation controller to reflect the current rotation
                effectController.animRotation = Math.floor((diamondContainer.rotation.y / (Math.PI * 2) * 360) % 360);
                // Update GUI controllers
                for (const controller of positionFolder.controllers) {
                    if (controller.property === 'animRotation') {
                        controller.updateDisplay();
                    }
                }
            }
            currentDiamond.updateMatrix();
            currentDiamond.updateMatrixWorld();
            currentDiamond.geometry.computeBoundingBox();
            boundingBox.setFromObject(currentDiamond, true);

            effectController.xSize = boundingBox.max.x - boundingBox.min.x;
            effectController.ySize = boundingBox.max.y - boundingBox.min.y;
            effectController.zSize = boundingBox.max.z - boundingBox.min.z;
        }


        effectPass.uniforms.exposure.value = effectController.exposure;

        renderer.setRenderTarget(defaultTexture);
        renderer.clear();
        backgroundCamera.quaternion.copy(camera.quaternion);
        renderer.render(backgroundScene, backgroundCamera);
        renderer.autoClear = false;
        renderer.render(scene, camera);
        renderer.autoClear = true;

        effectPass.uniforms["sceneDiffuse"].value = defaultTexture.texture;
        composer.render();
        controls.update();
        stats.update();
        requestAnimationFrame(animate);
    }

    function loadMeshFromServer(name, url, rotX, rotY, rotZ, pos) {                    
        const stlLoader = new STLLoader();
        try {
            stlLoader.load('/sync/sync.stl?cachebust=' + Date.now(), geometry =>{
                console.log("X: %s, Y: %s, Z: %s, pos: %s", rotX, rotY, rotZ, pos);
                geometry.translate(-pos[1], -pos[2], -pos[0]);
                geometry.rotateY(-rotZ);
                geometry.rotateX(-rotY);
                geometry.rotateZ(-rotX);
                loadGeometry(geometry, name + ".stl");
            })
        } catch (error) {
            console.error('Error parsing live sync STL:', error);
        }
    }

    const ws = new WebSocket("ws://localhost:3001");

    ws.onerror = (error) =>
    {
            console.log(error);

    }

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if(msg.type === "mesh") {
            console.log("name: %s, url: %s", msg.name, msg.url);
            loadMeshFromServer(msg.name, msg.url, msg.rotX, msg.rotY, msg.rotZ, msg.pos);
        }
    }

    requestAnimationFrame(animate);
}

main();


function createUiElements() {
    const fileInputContainer = document.createElement('div');
    fileInputContainer.style.position = 'absolute';
    fileInputContainer.style.top = '60px';
    fileInputContainer.style.left = '10px';
    fileInputContainer.style.zIndex = '1000';
    document.body.appendChild(fileInputContainer);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.glb,.gltf,.stl,.obj';
    fileInput.style.display = 'none';
    fileInputContainer.appendChild(fileInput);

    const uploadButton = document.createElement('button');
    uploadButton.textContent = 'Load Model';
    uploadButton.style.padding = '8px 16px';
    uploadButton.style.backgroundColor = '#4CAF50';
    uploadButton.style.color = 'white';
    uploadButton.style.border = 'none';
    uploadButton.style.borderRadius = '4px';
    uploadButton.style.cursor = 'pointer';
    uploadButton.style.fontSize = '16px';
    uploadButton.addEventListener('mouseover', () => {
        uploadButton.style.backgroundColor = '#45a049';
    });
    uploadButton.addEventListener('mouseout', () => {
        uploadButton.style.backgroundColor = '#4CAF50';
    });
    uploadButton.onclick = () => fileInput.click();
    fileInputContainer.appendChild(uploadButton);
    // File type indicator
    const fileTypeIndicator = document.createElement('div');
    fileTypeIndicator.textContent = 'Supported files: GLB, GLTF, STL, OBJ';
    fileTypeIndicator.style.position = 'absolute';
    fileTypeIndicator.style.top = '100px';
    fileTypeIndicator.style.left = '10px';
    fileTypeIndicator.style.color = 'white';
    fileTypeIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    fileTypeIndicator.style.padding = '5px 10px';
    fileTypeIndicator.style.borderRadius = '4px';
    fileTypeIndicator.style.fontSize = '12px';
    fileTypeIndicator.style.zIndex = '1000';
    document.body.appendChild(fileTypeIndicator);

    // Loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.textContent = 'Loading...';
    loadingIndicator.style.position = 'absolute';
    loadingIndicator.style.top = '50%';
    loadingIndicator.style.left = '50%';
    loadingIndicator.style.transform = 'translate(-50%, -50%)';
    loadingIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    loadingIndicator.style.color = 'white';
    loadingIndicator.style.padding = '20px';
    loadingIndicator.style.borderRadius = '5px';
    loadingIndicator.style.fontSize = '20px';
    loadingIndicator.style.display = 'none';
    document.body.appendChild(loadingIndicator);
    return { fileInput, loadingIndicator, uploadButton };
}
